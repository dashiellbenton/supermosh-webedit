import { useEffect, useState } from "react";

import { Icon } from "./components/Icon";
import { formatSeconds, pickMimeType, record } from "./lib";
import { Settings } from "./types";

export const ExportDialog = ({
  chunks,
  config,
  settings,
  onClose,
}: {
  chunks: EncodedVideoChunk[];
  config: VideoDecoderConfig;
  settings: Settings;
  onClose: () => unknown;
}) => {
  const [progress, setProgress] = useState(0);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [mimeType] = useState(pickMimeType);
  const ext = mimeType === "video/mp4" ? "mp4" : "webm";
  const [name] = useState(
    () =>
      `Supermosh_${new Date()
        .toISOString()
        .substring(0, 19)
        .replaceAll(":", "-")}.${ext}`,
  );

  useEffect(() => {
    const controller = new AbortController();
    record(chunks, config, mimeType, settings, setProgress, controller.signal)
      .then(setSrc)
      .catch((e) => {
        if (e?.name !== "AbortError") setError(String(e));
      });
    return () => controller.abort();
  }, [chunks, config, mimeType, settings]);

  return (
    <div
      className="modal-backdrop"
      onClick={src || error ? onClose : undefined}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Export</h2>
          <button className="icon" onClick={onClose} title="Close">
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <p className="warn">{error}</p>
        ) : src ? (
          <>
            <video src={src} muted loop controls playsInline autoPlay />
            <div className="actions">
              <a className="button primary" download={name} href={src}>
                <Icon name="download" /> Download .{ext}
              </a>
              <button onClick={onClose}>Back to editing</button>
            </div>
          </>
        ) : (
          <>
            <p>
              Rendering {formatSeconds(chunks.length)} at {settings.width}×
              {settings.height}. This happens in real time, keep this tab open.
            </p>
            <progress value={progress} />
            <div className="actions">
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
