import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { createFile, DataStream, MP4ArrayBuffer, MP4File } from "mp4box";

import { Clip, ResolvedClip, Settings, Vid } from "./types";

export const FPS = 30;

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const formatTime = (frames: number) => {
  const f = Math.max(0, Math.round(frames));
  const s = Math.floor(f / FPS);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const ff = String(f % FPS).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
};

export const formatSeconds = (frames: number) =>
  `${(frames / FPS).toFixed(2)}s`;

/** Lays the clips out on the timeline, applying the datamosh rules */
export const resolveTimeline = (clips: Clip[], vids: Vid[]) => {
  const resolved: ResolvedClip[] = [];
  let offset = 0;
  clips.forEach((clip, index) => {
    const vid = vids.find((v) => v.id === clip.vidId);
    if (!vid) return;
    const n = vid.chunks.length;
    // only the very first frame of the timeline is a key-frame
    const from = index === 0 ? 0 : Math.min(Math.max(1, clip.start), n);
    const to = Math.min(Math.max(clip.to, from + 1), n);
    const len = Math.max(0, to - from);
    const frames = len * clip.repeat;
    resolved.push({ clip, vid, index, from, to, len, frames, offset });
    offset += frames;
  });
  return resolved;
};

export const buildChunks = (resolved: ResolvedClip[]) =>
  resolved.flatMap((r) => {
    const slice = r.vid.chunks.slice(r.from, r.to);
    return Array.from({ length: r.clip.repeat }, () => slice).flat();
  });

/** Short side of the settings snapped to `short`, keeping the aspect ratio */
export const withShortSide = (settings: Settings, short: number): Settings => {
  const ratio = settings.width / settings.height;
  const snap = (n: number) => Math.max(4, Math.round(n / 4) * 4);
  return ratio >= 1
    ? { width: snap(short * ratio), height: short }
    : { width: short, height: snap(short / ratio) };
};

export const settingsFromSize = (w: number, h: number, short: number) =>
  withShortSide({ width: w, height: h }, short);

export const makeThumb = (file: File, src: string, isImage: boolean) =>
  new Promise<{ thumb: string; width: number; height: number }>((resolve) => {
    const fail = () => resolve({ thumb: "", width: 640, height: 480 });
    const finish = (el: CanvasImageSource, w: number, h: number) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.height = 96;
        canvas.width = Math.max(1, Math.round((96 * w) / h));
        canvas.getContext("2d")!.drawImage(el, 0, 0, canvas.width, 96);
        resolve({
          thumb: canvas.toDataURL("image/jpeg", 0.7),
          width: w,
          height: h,
        });
      } catch {
        fail();
      }
    };
    if (isImage || file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => finish(img, img.naturalWidth, img.naturalHeight);
      img.onerror = fail;
      img.src = src;
    } else {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.onerror = fail;
      video.onloadeddata = () => {
        video.currentTime = Math.min(0.1, video.duration / 2 || 0);
      };
      video.onseeked = () =>
        finish(video, video.videoWidth || 640, video.videoHeight || 480);
      video.src = src;
    }
  });

const computeDescription = (file: MP4File, trackId: number) => {
  const track = file.getTrackById(trackId);
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error("avcC, hvcC, vpcC, or av1C box not found");
};

export const computeChunks = (
  ffmpeg: FFmpeg,
  inputFile: File,
  name: string,
  width: number,
  height: number,
  onConfig: (config: VideoDecoderConfig) => unknown,
) =>
  new Promise<EncodedVideoChunk[]>(async (resolve, reject) => {
    try {
      const inputName = `input_${name}.mp4`;
      const outputName = `output_${name}_${Math.random()
        .toFixed(10)
        .substring(2)}.mp4`;
      await ffmpeg.writeFile(inputName, await fetchFile(inputFile));
      await ffmpeg.exec(
        `-i ${inputName} -vf scale=${width}:${height} -r ${FPS} -an -vcodec libx264 -g 99999999 -bf 0 -flags:v +cgop -pix_fmt yuv420p -movflags faststart -crf 15 ${outputName}`.split(
          " ",
        ),
      );
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});

      const file = createFile();
      file.onError = reject;
      file.onReady = (info) => {
        const track = info.videoTracks[0];
        onConfig({
          codec: track.codec.startsWith("vp08") ? "vp8" : track.codec,
          codedHeight: track.video.height,
          codedWidth: track.video.width,
          description: computeDescription(file, track.id),
        });
        file.setExtractionOptions(track.id);
        file.start();
      };
      file.onSamples = (_trackId, _ref, samples) => {
        resolve(
          samples.map(
            (sample) =>
              new EncodedVideoChunk({
                type: sample.is_sync ? "key" : "delta",
                timestamp: (1e6 * sample.cts) / sample.timescale,
                duration: (1e6 * sample.duration) / sample.timescale,
                data: sample.data,
              }),
          ),
        );
      };
      const buffer = new ArrayBuffer(data.byteLength) as MP4ArrayBuffer;
      new Uint8Array(buffer).set(data);
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
    } catch (e) {
      reject(e);
    }
  });

export const pickMimeType = () =>
  MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";

/** Plays the chunks in real time on a canvas and records the result */
export const record = async (
  chunks: EncodedVideoChunk[],
  config: VideoDecoderConfig,
  mimeType: string,
  settings: Settings,
  onProgress: (progress: number) => unknown,
  signal?: AbortSignal,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = settings.width;
  canvas.height = settings.height;
  const ctx = canvas.getContext("2d")!;

  const decoder = new VideoDecoder({
    error: console.error,
    output: (frame) => {
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    },
  });
  decoder.configure(config);

  const recorder = new MediaRecorder(canvas.captureStream(FPS), { mimeType });
  const result = new Promise<string>((resolve) =>
    recorder.addEventListener("dataavailable", (evt) =>
      resolve(URL.createObjectURL(evt.data)),
    ),
  );

  recorder.start();
  const t0 = performance.now();
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const wait = t0 + (i * 1000) / FPS - performance.now();
      if (wait > 0) await sleep(wait);
      decoder.decode(chunks[i]);
      onProgress((i + 1) / chunks.length);
    }
    await decoder.flush();
    await sleep((3 * 1000) / FPS);
  } finally {
    recorder.stop();
    if (decoder.state !== "closed") decoder.close();
  }
  return result;
};
