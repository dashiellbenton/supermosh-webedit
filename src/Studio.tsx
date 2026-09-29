import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "./components/Icon";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import {
  buildChunks,
  clamp,
  computeChunks,
  FPS,
  makeThumb,
  resolveTimeline,
  settingsFromSize,
  withShortSide,
} from "./lib";
import { MediaBin } from "./MediaBin";
import { Monitor } from "./Monitor";
import { Timeline } from "./Timeline";
import { Clip, Settings, Vid } from "./types";

const newId = () => Math.random().toString(36).slice(2, 10);
const QUALITIES = [480, 720, 1080];

export const Studio = () => {
  const ffmpegRef = useRef(new FFmpeg());
  const engineRef = useRef<Promise<void> | null>(null);
  const [engine, setEngine] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [ffProgress, setFfProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const [vids, setVids] = useState<Vid[]>([]);
  const vidsRef = useRef(vids);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    width: 640,
    height: 480,
  });
  const settingsRef = useRef(settings);
  const decidedAspect = useRef(false);
  const procKeys = useRef<Record<string, string>>({});
  const reprocessTimer = useRef<number>(0);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [ppf, setPpf] = useState(4);
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    vidsRef.current = vids;
  }, [vids]);

  // ---- engine -------------------------------------------------------------
  useEffect(() => {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on("progress", (evt) => setFfProgress(clamp(evt.progress, 0, 1)));
    const promise = (async () => {
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
    })();
    engineRef.current = promise;
    promise.then(
      () => setEngine("ready"),
      (e) => {
        console.error(e);
        setEngine("error");
      },
    );
  }, []);

  // ---- media --------------------------------------------------------------
  const patchVid = useCallback(
    (id: string, patch: Partial<Vid>) =>
      setVids((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      ),
    [],
  );

  const processVid = useCallback(
    (id: string, file: File) => {
      queueRef.current = queueRef.current.then(async () => {
        try {
          await engineRef.current;
          const s = settingsRef.current;
          const key = `${s.width}x${s.height}`;
          if (procKeys.current[id] === key) return;
          setActiveId(id);
          setFfProgress(0);
          let config: VideoDecoderConfig | null = null;
          const chunks = await computeChunks(
            ffmpegRef.current,
            file,
            id,
            s.width,
            s.height,
            (c) => (config = c),
          );
          procKeys.current[id] = key;
          patchVid(id, { chunks, config, status: "ready" });
        } catch (e) {
          console.error(e);
          patchVid(id, { status: "error" });
        } finally {
          setActiveId(null);
        }
      });
    },
    [patchVid],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (!/^(video|image)\//.test(file.type)) continue;
        const id = newId();
        const src = URL.createObjectURL(file);
        const isImage = file.type.startsWith("image/");
        const { thumb, width, height } = await makeThumb(file, src, isImage);
        if (!decidedAspect.current) {
          // match the output to the first file so nothing gets stretched
          decidedAspect.current = true;
          const s = settingsFromSize(width, height, 480);
          settingsRef.current = s;
          setSettings(s);
        }
        setVids((prev) => {
          let name = file.name.replace(/\s/g, "_");
          const base = name;
          for (let i = 0; prev.some((v) => v.name === name); i++) {
            name = `${base}_${i}`;
          }
          return [
            ...prev,
            {
              id,
              src,
              file,
              name,
              thumb,
              isImage,
              status: "processing",
              chunks: [],
              config: null,
            },
          ];
        });
        processVid(id, file);
      }
    },
    [processVid],
  );

  const applySettings = (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    window.clearTimeout(reprocessTimer.current);
    reprocessTimer.current = window.setTimeout(() => {
      for (const vid of vidsRef.current) {
        const key = `${next.width}x${next.height}`;
        if (procKeys.current[vid.id] === key) continue;
        patchVid(vid.id, { status: "processing" });
        processVid(vid.id, vid.file);
      }
    }, 500);
  };

  const removeVid = (id: string) => {
    setClips((prev) => prev.filter((c) => c.vidId !== id));
    setVids((prev) => prev.filter((v) => v.id !== id));
  };

  // ---- timeline -----------------------------------------------------------
  const resolved = useMemo(() => resolveTimeline(clips, vids), [clips, vids]);
  const total = resolved.reduce((sum, r) => sum + r.frames, 0);
  const allReady = vids.every((v) => v.status === "ready");
  const chunks = useMemo(
    () => (allReady ? buildChunks(resolved) : []),
    [allReady, resolved],
  );
  const config = resolved[0]?.vid.config ?? null;
  const selected = resolved.find((r) => r.clip.id === selectedId) ?? null;

  const addClip = useCallback((vidId: string, index?: number) => {
    const vid = vidsRef.current.find((v) => v.id === vidId);
    if (!vid) return;
    const clip: Clip = {
      id: newId(),
      vidId,
      start: 1,
      to: Infinity, // until the end, whatever the length ends up being
      repeat: 1,
    };
    setClips((prev) => {
      const next = [...prev];
      next.splice(index ?? prev.length, 0, clip);
      return next;
    });
    setSelectedId(clip.id);
  }, []);

  const updateClip = useCallback(
    (id: string, patch: Partial<Clip>) =>
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      ),
    [],
  );
  const moveClip = useCallback((id: string, index: number) => {
    setClips((prev) => {
      const from = prev.findIndex((c) => c.id === id);
      if (from < 0) return prev;
      const next = [...prev];
      const [clip] = next.splice(from, 1);
      next.splice(clip ? index : 0, 0, clip);
      return next;
    });
  }, []);
  const removeClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);
  const duplicateClip = (id: string) => {
    const index = clips.findIndex((c) => c.id === id);
    if (index < 0) return;
    const copy = { ...clips[index], id: newId() };
    setClips([...clips.slice(0, index + 1), copy, ...clips.slice(index + 1)]);
    setSelectedId(copy.id);
  };
  const splitAtPlayhead = () => {
    const r = resolved.find(
      (x) => playhead >= x.offset && playhead < x.offset + x.frames,
    );
    if (!r || r.clip.repeat !== 1) return;
    const at = r.from + (playhead - r.offset);
    if (at <= r.from || at >= r.to) return;
    const right: Clip = { ...r.clip, id: newId(), start: at };
    setClips(
      clips.flatMap((c) =>
        c.id === r.clip.id ? [{ ...c, to: at }, right] : [c],
      ),
    );
    setSelectedId(right.id);
  };

  // ---- transport ----------------------------------------------------------
  const seek = useCallback(
    (frame: number) => setPlayhead(Math.max(0, Math.round(frame))),
    [],
  );
  const shownPlayhead = clamp(playhead, 0, Math.max(0, total - 1));
  const playheadRef = useRef(shownPlayhead);
  const totalRef = useRef(total);
  const loopRef = useRef(loop);
  useEffect(() => {
    playheadRef.current = shownPlayhead;
    totalRef.current = total;
    loopRef.current = loop;
  });

  useEffect(() => {
    if (!playing || total === 0) return;
    const base =
      playheadRef.current >= totalRef.current - 1 ? 0 : playheadRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const frame = base + Math.floor(((now - start) * FPS) / 1000);
      const t = totalRef.current;
      if (frame >= t && !loopRef.current) {
        setPlayhead(Math.max(0, t - 1));
        setPlaying(false);
        return;
      }
      setPlayhead(t > 0 ? frame % t : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = () => {
    if (total === 0) return;
    setPlaying((p) => !p);
  };
  const pause = () => setPlaying(false);

  // ---- shortcuts ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        seek(shownPlayhead - (e.shiftKey ? FPS : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        seek(shownPlayhead + (e.shiftKey ? FPS : 1));
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(total - 1);
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        removeClip(selectedId);
      } else if (e.key.toLowerCase() === "s") splitAtPlayhead();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- drag & drop of files anywhere ---------------------------------------
  const hasFiles = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("Files");

  const processing = vids.filter((v) => v.status === "processing").length;
  const shortSide = Math.min(settings.width, settings.height);

  return (
    <main
      className="Studio"
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          setDragOver(false);
          void importFiles([...e.dataTransfer.files]);
        }
      }}
    >
      <header className="topbar">
        <Link to="/" className="brand" title="Back to the homepage">
          <Icon name="movie_filter" /> Supermosh
        </Link>
        <div className="topbar-group">
          <span className="label">Output</span>
          <div className="segmented">
            {QUALITIES.map((q) => (
              <button
                key={q}
                className={shortSide === q ? "active" : ""}
                onClick={() => applySettings(withShortSide(settings, q))}
              >
                {q}p
              </button>
            ))}
          </div>
          <button
            className="ghost"
            title="Switch between landscape and portrait"
            onClick={() =>
              applySettings({ width: settings.height, height: settings.width })
            }
          >
            <Icon name="screen_rotation" />
          </button>
          <span className="muted">
            {settings.width}×{settings.height}
          </span>
        </div>
        <div className="spacer" />
        <span className={`status ${engine}`}>
          {engine === "loading" && "Loading video engine…"}
          {engine === "error" &&
            "Video engine failed to load (check your connection)"}
          {engine === "ready" && processing > 0 && "Preparing footage…"}
          {engine === "ready" && processing === 0 && "Ready"}
        </span>
        <a
          className="ghost-link"
          href="https://github.com/supermosh/supermosh.github.io/issues"
          title="Report a bug"
        >
          <Icon name="bug_report" />
        </a>
        <button
          className="primary"
          disabled={chunks.length === 0 || !config}
          onClick={() => {
            pause();
            setExporting(true);
          }}
        >
          <Icon name="download" /> Export
        </button>
      </header>

      <MediaBin
        vids={vids}
        activeId={activeId}
        progress={ffProgress}
        disabled={engine === "error"}
        onImport={importFiles}
        onAdd={(id) => addClip(id)}
        onRemove={removeVid}
      />

      <Monitor
        chunks={chunks}
        config={config}
        settings={settings}
        playhead={shownPlayhead}
        total={total}
        playing={playing}
        loop={loop}
        busy={!allReady}
        empty={vids.length === 0}
        resolved={resolved}
        onImport={importFiles}
        onSeek={(f) => {
          pause();
          seek(f);
        }}
        onTogglePlay={togglePlay}
        onToggleLoop={() => setLoop(!loop)}
        onStep={(d) => {
          pause();
          seek(shownPlayhead + d);
        }}
      />

      <Inspector
        selected={selected}
        resolved={resolved}
        total={total}
        onUpdate={updateClip}
        onSeek={(f) => {
          pause();
          seek(f);
        }}
        onDuplicate={duplicateClip}
        onRemove={removeClip}
        onMove={moveClip}
        onSplit={splitAtPlayhead}
      />

      <Timeline
        resolved={resolved}
        total={total}
        selectedId={selectedId}
        playhead={shownPlayhead}
        playing={playing}
        ppf={ppf}
        hasVids={vids.length > 0}
        onPpf={setPpf}
        onSelect={setSelectedId}
        onSeek={(f) => {
          pause();
          seek(f);
        }}
        onTrim={updateClip}
        onMove={moveClip}
        onDropVid={addClip}
        onRemove={removeClip}
      />

      {dragOver && (
        <div className="dropzone-overlay">
          <Icon name="upload_file" /> Drop videos or images to import
        </div>
      )}
      {exporting && config && (
        <ExportDialog
          chunks={chunks}
          config={config}
          settings={settings}
          onClose={() => setExporting(false)}
        />
      )}
    </main>
  );
};
