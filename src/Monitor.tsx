import { useEffect, useRef, useState } from "react";

import { Icon } from "./components/Icon";
import { formatTime } from "./lib";
import { MoshPlayer } from "./player";
import { ResolvedClip, Settings } from "./types";

export const Monitor = ({
  chunks,
  config,
  settings,
  playhead,
  total,
  playing,
  loop,
  busy,
  empty,
  resolved,
  onImport,
  onSeek,
  onTogglePlay,
  onToggleLoop,
  onStep,
}: {
  chunks: EncodedVideoChunk[];
  config: VideoDecoderConfig | null;
  settings: Settings;
  playhead: number;
  total: number;
  playing: boolean;
  loop: boolean;
  busy: boolean;
  empty: boolean;
  resolved: ResolvedClip[];
  onImport: (files: File[]) => unknown;
  onSeek: (frame: number) => unknown;
  onTogglePlay: () => unknown;
  onToggleLoop: () => unknown;
  onStep: (delta: number) => unknown;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [player] = useState(() => new MoshPlayer());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    player.attach(canvas.current);
    return () => player.destroy();
  }, [player]);

  // resizing the canvas clears it: attach again to force a redraw
  useEffect(() => {
    player.attach(canvas.current);
    player.seek(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, settings.width, settings.height]);

  useEffect(() => {
    player.setSource(chunks, config);
    player.seek(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, chunks, config]);

  useEffect(() => {
    player.seek(playhead);
  }, [player, playhead]);

  const current = resolved.find(
    (r) => playhead >= r.offset && playhead < r.offset + r.frames,
  );
  const sinceCut =
    current && current.index > 0 ? playhead - current.offset : -1;

  return (
    <section className="Monitor">
      <div className="stage">
        <div
          className="screen"
          style={{
            aspectRatio: `${settings.width} / ${settings.height}`,
            ["--ar" as string]: settings.width / settings.height,
          }}
        >
          <canvas
            ref={canvas}
            width={settings.width}
            height={settings.height}
            onClick={onTogglePlay}
          />
          {empty && (
            <div className="overlay empty">
              <Icon name="upload_file" />
              <h3>Drop your footage here</h3>
              <p>
                Import at least two clips. Supermosh glues them together so the
                motion of one bleeds into the other.
              </p>
              <button
                className="primary"
                onClick={() => input.current?.click()}
              >
                <Icon name="add" /> Import media
              </button>
              <input
                ref={input}
                type="file"
                accept="video/*,image/*"
                multiple
                hidden
                onChange={(e) => {
                  void onImport([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          {!empty && total === 0 && !busy && (
            <div className="overlay">
              <p>Add a clip to the timeline to see it here.</p>
            </div>
          )}
          {busy && !empty && (
            <div className="overlay busy">
              <span className="spinner big" /> Preparing footage…
            </div>
          )}
          {sinceCut >= 0 && sinceCut < FPS_FLASH && (
            <span className="badge mosh">MOSH</span>
          )}
          {current && (
            <span className="badge clipname">
              {current.index + 1}. {current.vid.name}
            </span>
          )}
        </div>
      </div>
      <div className="transport">
        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={playhead}
          disabled={total === 0}
          onChange={(e) => onSeek(Number(e.target.value))}
          style={{
            ["--pct" as string]: `${total > 1 ? (playhead / (total - 1)) * 100 : 0}%`,
          }}
        />
        <div className="transport-row">
          <span className="timecode">
            {formatTime(playhead)}{" "}
            <span className="muted">/ {formatTime(total)}</span>
          </span>
          <div className="controls">
            <button
              className="icon"
              title="Start (Home)"
              onClick={() => onSeek(0)}
            >
              <Icon name="skip_previous" />
            </button>
            <button
              className="icon"
              title="Previous frame (←)"
              onClick={() => onStep(-1)}
            >
              <Icon name="chevron_left" />
            </button>
            <button
              className="icon play"
              title="Play / pause (Space)"
              disabled={total === 0}
              onClick={onTogglePlay}
            >
              <Icon name={playing ? "pause" : "play_arrow"} />
            </button>
            <button
              className="icon"
              title="Next frame (→)"
              onClick={() => onStep(1)}
            >
              <Icon name="chevron_right" />
            </button>
            <button
              className="icon"
              title="End (End)"
              onClick={() => onSeek(total - 1)}
            >
              <Icon name="skip_next" />
            </button>
          </div>
          <button
            className={`icon ${loop ? "on" : ""}`}
            title="Loop playback"
            onClick={onToggleLoop}
          >
            <Icon name="repeat" />
          </button>
        </div>
      </div>
    </section>
  );
};

const FPS_FLASH = 12;
