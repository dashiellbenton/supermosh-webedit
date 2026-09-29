export type Settings = {
  width: number;
  height: number;
};

export type Vid = {
  id: string;
  src: string;
  file: File;
  name: string;
  thumb: string;
  isImage: boolean;
  status: "processing" | "ready" | "error";
  chunks: EncodedVideoChunk[];
  config: VideoDecoderConfig | null;
};

/**
 * A piece of the timeline. Every source is re-encoded with a single key-frame
 * (frame 0), so the first clip keeps its key-frame and every following clip
 * skips it: its motion (P-frames) gets applied on top of the previous image,
 * which is what produces the datamosh.
 */
export type Clip = {
  id: string;
  vidId: string;
  /** first frame used, ignored for the first clip (always 0) */
  start: number;
  /** frame after the last frame used */
  to: number;
  /** how many times the frames are played in a row (bloom) */
  repeat: number;
};

export type ResolvedClip = {
  clip: Clip;
  vid: Vid;
  index: number;
  from: number;
  to: number;
  /** frames in one pass */
  len: number;
  /** frames on the timeline, including repeats */
  frames: number;
  /** first timeline frame of this clip */
  offset: number;
};
