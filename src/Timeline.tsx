import { useEffect, useRef, useState } from "react";

import { Icon } from "./components/Icon";
import { clamp, formatSeconds, FPS } from "./lib";
import { Clip, ResolvedClip } from "./types";

const MIN_BLOCK = 44;
const TICKS = [0.5, 1, 2, 5, 10, 30, 60, 120];

export const Timeline = ({
  resolved,
  total,
  selectedId,
  playhead,
  playing,
  ppf,
  hasVids,
  onPpf,
  onSelect,
  onSeek,
  onTrim,
  onMove,
  onDropVid,
  onRemove,
}: {
  resolved: ResolvedClip[];
  total: number;
  selectedId: string | null;
  playhead: number;
  playing: boolean;
  ppf: number;
  hasVids: boolean;
  onPpf: (ppf: number) => unknown;
  onSelect: (id: string | null) => unknown;
  onSeek: (frame: number) => unknown;
  onTrim: (id: string, patch: Partial<Clip>) => unknown;
  onMove: (id: string, index: number) => unknown;
  onDropVid: (vidId: string, index: number) => unknown;
  onRemove: (id: string) => unknown;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    dx: number;
    index: number;
  } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const width = (frames: number) =>
    Math.max(frames * ppf, frames > 0 ? 2 : MIN_BLOCK);

  const insertionIndex = (centerX: number, excludeId?: string) =>
    resolved
      .filter((r) => r.clip.id !== excludeId)
      .filter((r) => (r.offset + r.frames / 2) * ppf < centerX).length;

  const insertionX = (index: number, excludeId?: string) =>
    resolved
      .filter((r) => r.clip.id !== excludeId)
      .slice(0, index)
      .reduce((sum, r) => sum + width(r.frames), 0);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = playhead * ppf;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - 80);
    }
  }, [playhead, playing, ppf]);

  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent | React.PointerEvent) => {
      const rect = inner.current!.getBoundingClientRect();
      onSeek(
        clamp(
          Math.floor((ev.clientX - rect.left) / ppf),
          0,
          Math.max(0, total - 1),
        ),
      );
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const startTrim = (
    e: React.PointerEvent,
    r: ResolvedClip,
    side: "start" | "end",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    onSelect(r.clip.id);
    const startX = e.clientX;
    const n = r.vid.chunks.length;
    const rep = r.clip.repeat;
    const move = (ev: PointerEvent) => {
      const dframes = (ev.clientX - startX) / (ppf * rep);
      if (side === "end") {
        const to = clamp(
          Math.round(r.to + dframes),
          r.from + 1,
          Math.max(r.from + 1, n),
        );
        onTrim(r.clip.id, { to });
        onSeek(r.offset + (to - r.from) * rep - 1);
      } else {
        const start = clamp(
          Math.round(r.from + dframes),
          1,
          Math.max(1, r.to - 1),
        );
        onTrim(r.clip.id, { start });
        onSeek(r.offset);
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const startReorder = (e: React.PointerEvent, r: ResolvedClip) => {
    if (e.button !== 0) return;
    onSelect(r.clip.id);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const center = (r.offset + r.frames / 2) * ppf;
    let moved = false;
    let index = r.index;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 5) return;
      moved = true;
      index = insertionIndex(center + dx, r.clip.id);
      setDrag({ id: r.clip.id, dx, index });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDrag(null);
      if (moved && index !== r.index) onMove(r.clip.id, index);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const step =
    TICKS.find((t) => t * FPS * ppf >= 70) ?? TICKS[TICKS.length - 1];
  const contentWidth = resolved.reduce((sum, r) => sum + width(r.frames), 0);
  const trackWidth = contentWidth + 320;
  const ticks = Array.from(
    { length: Math.ceil(trackWidth / (step * FPS * ppf)) + 1 },
    (_, i) => i * step,
  );

  return (
    <section className="Timeline">
      <div className="timeline-tools">
        <span className="label">Timeline</span>
        <span className="muted">
          {formatSeconds(total)} · {resolved.length} clip
          {resolved.length === 1 ? "" : "s"}
        </span>
        <div className="spacer" />
        <button
          className="icon"
          title="Zoom out"
          onClick={() => onPpf(clamp(ppf / 1.5, 0.25, 24))}
        >
          <Icon name="zoom_out" />
        </button>
        <input
          className="zoom"
          type="range"
          min={Math.log(0.25)}
          max={Math.log(24)}
          step={0.01}
          value={Math.log(ppf)}
          onChange={(e) => onPpf(Math.exp(Number(e.target.value)))}
        />
        <button
          className="icon"
          title="Zoom in"
          onClick={() => onPpf(clamp(ppf * 1.5, 0.25, 24))}
        >
          <Icon name="zoom_in" />
        </button>
        <button
          className="icon"
          title="Fit the whole timeline"
          onClick={() => {
            const w = scroller.current?.clientWidth ?? 800;
            if (total > 0) onPpf(clamp((w - 60) / total, 0.25, 24));
          }}
        >
          <Icon name="fit_screen" />
        </button>
      </div>
      <div className="timeline-scroll" ref={scroller}>
        <div
          className="timeline-inner"
          ref={inner}
          style={{ width: trackWidth }}
        >
          <div className="ruler" onPointerDown={scrub}>
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: t * FPS * ppf }}>
                {t % 60 === 0 ? `${t / 60}m` : `${t}s`}
              </span>
            ))}
          </div>
          <div
            className="track"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                onSelect(null);
                scrub(e);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-vid")) {
                e.preventDefault();
                e.stopPropagation();
                const rect = inner.current!.getBoundingClientRect();
                setDropIndex(insertionIndex(e.clientX - rect.left));
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDropIndex(null);
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("application/x-vid");
              if (id) {
                e.preventDefault();
                e.stopPropagation();
                const rect = inner.current!.getBoundingClientRect();
                onDropVid(id, insertionIndex(e.clientX - rect.left));
              }
              setDropIndex(null);
            }}
          >
            {resolved.length === 0 && (
              <div className="track-empty">
                {hasVids
                  ? "Drag media here, or press + on a file"
                  : "Import media to start building your mosh"}
              </div>
            )}
            {resolved.map((r, i) => {
              const left = insertionX(i);
              const w = width(r.frames);
              const dragging = drag?.id === r.clip.id;
              const loopPx = r.len * ppf;
              return (
                <div
                  key={r.clip.id}
                  className={`clip ${r.clip.id === selectedId ? "selected" : ""} ${
                    dragging ? "dragging" : ""
                  } ${r.len === 0 ? "empty" : ""}`}
                  style={{
                    left,
                    width: w,
                    transform: dragging
                      ? `translateX(${drag.dx}px)`
                      : undefined,
                    backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.05) 60%), ${
                      r.clip.repeat > 1 && loopPx > 3
                        ? `repeating-linear-gradient(90deg, transparent 0 ${
                            loopPx - 2
                          }px, rgba(255,255,255,.75) ${loopPx - 2}px ${loopPx}px), `
                        : ""
                    }url(${r.vid.thumb})`,
                  }}
                  onPointerDown={(e) => startReorder(e, r)}
                  onKeyDown={(e) => e.key === "Delete" && onRemove(r.clip.id)}
                  title={`${r.vid.name} · ${formatSeconds(r.frames)}`}
                >
                  {r.index > 0 ? (
                    <div
                      className="handle start"
                      title="Drag to trim the start"
                      onPointerDown={(e) => startTrim(e, r, "start")}
                    />
                  ) : (
                    <span
                      className="keyflag"
                      title="Key-frame: the only full picture in the whole mosh"
                    >
                      <Icon name="key" />
                    </span>
                  )}
                  <span className="clip-label">
                    {r.index + 1}. {r.vid.name}
                    {r.clip.repeat > 1 && (
                      <b className="bloom">×{r.clip.repeat}</b>
                    )}
                  </span>
                  <div
                    className="handle end"
                    title="Drag to trim the end"
                    onPointerDown={(e) => startTrim(e, r, "end")}
                  />
                </div>
              );
            })}
            {resolved
              .filter((r) => r.index > 0)
              .map((r) => (
                <span
                  key={`cut-${r.clip.id}`}
                  className="cut"
                  style={{ left: r.offset * ppf }}
                  title="Mosh cut: this clip's motion is applied on the previous image"
                >
                  <Icon name="bolt" />
                </span>
              ))}
            {drag && (
              <span
                className="drop-line"
                style={{ left: insertionX(drag.index, drag.id) }}
              />
            )}
            {dropIndex !== null && (
              <span
                className="drop-line"
                style={{ left: insertionX(dropIndex) }}
              />
            )}
          </div>
          {total > 0 && (
            <div className="playhead" style={{ left: playhead * ppf }}>
              <span className="playhead-cap" onPointerDown={scrub} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
