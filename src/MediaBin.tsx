import { useRef } from "react";

import { Icon } from "./components/Icon";
import { formatSeconds } from "./lib";
import { Vid } from "./types";

export const MediaBin = ({
  vids,
  activeId,
  progress,
  disabled,
  onImport,
  onAdd,
  onRemove,
}: {
  vids: Vid[];
  activeId: string | null;
  progress: number;
  disabled: boolean;
  onImport: (files: File[]) => unknown;
  onAdd: (vidId: string) => unknown;
  onRemove: (vidId: string) => unknown;
}) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <aside className="panel MediaBin">
      <div className="panel-head">
        <h2>Media</h2>
        <button disabled={disabled} onClick={() => input.current?.click()}>
          <Icon name="add" /> Import
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
      <div className="panel-body">
        {vids.length === 0 ? (
          <p className="hint">
            Import videos or images, then drag them onto the timeline (or click
            <b> +</b>). Everything stays in your browser.
          </p>
        ) : (
          <ul className="media-list">
            {vids.map((vid) => (
              <li
                key={vid.id}
                className={`media-item ${vid.status}`}
                draggable={vid.status === "ready"}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-vid", vid.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => vid.status === "ready" && onAdd(vid.id)}
              >
                <div
                  className="thumb"
                  style={{ backgroundImage: `url(${vid.thumb})` }}
                >
                  {vid.status === "processing" && <span className="spinner" />}
                </div>
                <div className="media-info">
                  <span className="media-name" title={vid.name}>
                    {vid.name}
                  </span>
                  <span className="muted">
                    {vid.status === "processing"
                      ? vid.id === activeId
                        ? `Preparing… ${Math.round(progress * 100)}%`
                        : "Queued…"
                      : vid.status === "error"
                        ? "Could not read this file"
                        : vid.isImage
                          ? "Image"
                          : formatSeconds(vid.chunks.length)}
                  </span>
                </div>
                <button
                  className="icon"
                  title="Add to the end of the timeline"
                  disabled={vid.status !== "ready"}
                  onClick={() => onAdd(vid.id)}
                >
                  <Icon name="add" />
                </button>
                <button
                  className="icon"
                  title="Remove from project"
                  onClick={() => onRemove(vid.id)}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
