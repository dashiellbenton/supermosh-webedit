import { Icon } from "./components/Icon";
import { clamp, formatSeconds } from "./lib";
import { Clip, ResolvedClip } from "./types";

const BLOOMS = [1, 2, 4, 8, 16, 32];

export const Inspector = ({
  selected,
  resolved,
  total,
  onUpdate,
  onSeek,
  onDuplicate,
  onRemove,
  onMove,
  onSplit,
}: {
  selected: ResolvedClip | null;
  resolved: ResolvedClip[];
  total: number;
  onUpdate: (id: string, patch: Partial<Clip>) => unknown;
  onSeek: (frame: number) => unknown;
  onDuplicate: (id: string) => unknown;
  onRemove: (id: string) => unknown;
  onMove: (id: string, index: number) => unknown;
  onSplit: () => unknown;
}) => {
  if (!selected) {
    const cuts = Math.max(0, resolved.length - 1);
    return (
      <aside className="panel Inspector">
        <div className="panel-head">
          <h2>Inspector</h2>
        </div>
        <div className="panel-body">
          <dl className="stats">
            <div>
              <dt>Clips</dt>
              <dd>{resolved.length}</dd>
            </div>
            <div>
              <dt>Mosh cuts</dt>
              <dd>{cuts}</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{formatSeconds(total)}</dd>
            </div>
          </dl>
          {resolved.length === 0 ? (
            <p className="hint">Add clips to the timeline to start.</p>
          ) : resolved.length === 1 ? (
            <p className="hint">
              Add a second clip: the cut between two clips is where the mosh
              happens.
            </p>
          ) : (
            <p className="hint">Select a clip to trim it or make it bloom.</p>
          )}
          <h3>How it works</h3>
          <p className="hint">
            The first clip plays normally. Every following clip is stripped of
            its opening key-frame, so its <b>motion</b> is painted over the
            <b> last image</b> of the previous clip instead of replacing it.
          </p>
          <p className="hint">
            <b>Bloom</b> repeats a clip's motion again and again, smearing the
            image further each time.
          </p>
          <h3>Shortcuts</h3>
          <ul className="keys">
            <li>
              <kbd>Space</kbd> play / pause
            </li>
            <li>
              <kbd>←</kbd> <kbd>→</kbd> step a frame
            </li>
            <li>
              <kbd>S</kbd> split at playhead
            </li>
            <li>
              <kbd>Del</kbd> remove clip
            </li>
          </ul>
        </div>
      </aside>
    );
  }

  const { clip, vid, index, from, to, len } = selected;
  const n = vid.chunks.length;
  const isFirst = index === 0;
  const onlyImage = n <= 1 && !isFirst;

  return (
    <aside className="panel Inspector">
      <div className="panel-head">
        <h2>Clip {index + 1}</h2>
        <span className={`tag ${isFirst ? "key" : "mosh"}`}>
          {isFirst ? "Key-frame start" : "Mosh cut"}
        </span>
      </div>
      <div className="panel-body">
        <div className="clip-title">
          <div
            className="thumb"
            style={{ backgroundImage: `url(${vid.thumb})` }}
          />
          <span title={vid.name}>{vid.name}</span>
        </div>

        {onlyImage && (
          <p className="warn">
            Images have no motion to mosh. Put an image first in the timeline to
            use it as the starting picture.
          </p>
        )}

        <label className="field">
          <span>
            Start <b>{formatSeconds(from)}</b>
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(1, to - 1)}
            value={Math.max(1, from)}
            disabled={isFirst || len <= 0}
            onChange={(e) => {
              const start = clamp(Number(e.target.value), 1, to - 1);
              onUpdate(clip.id, { start });
              onSeek(selected.offset);
            }}
          />
          {isFirst && (
            <small>The first clip always starts on its key-frame.</small>
          )}
        </label>

        <label className="field">
          <span>
            End <b>{formatSeconds(to)}</b>
          </span>
          <input
            type="range"
            min={from + 1}
            max={Math.max(from + 1, n)}
            value={to}
            disabled={n <= from + 1}
            onChange={(e) => {
              const newTo = clamp(Number(e.target.value), from + 1, n);
              onUpdate(clip.id, { to: newTo });
              onSeek(selected.offset + (newTo - from) * clip.repeat - 1);
            }}
          />
        </label>

        <div className="field">
          <span>
            Bloom <b>×{clip.repeat}</b>
            <span className="muted"> · {formatSeconds(len * clip.repeat)}</span>
          </span>
          <input
            type="range"
            min={1}
            max={64}
            value={clip.repeat}
            disabled={len <= 0}
            onChange={(e) => {
              onUpdate(clip.id, { repeat: Number(e.target.value) });
              onSeek(selected.offset);
            }}
          />
          <div className="chips">
            {BLOOMS.map((b) => (
              <button
                key={b}
                className={clip.repeat === b ? "active" : ""}
                disabled={len <= 0}
                onClick={() => {
                  onUpdate(clip.id, { repeat: b });
                  onSeek(selected.offset);
                }}
              >
                ×{b}
              </button>
            ))}
          </div>
        </div>

        <div className="actions">
          <button
            onClick={onSplit}
            title="Split at playhead (S)"
            disabled={clip.repeat !== 1}
          >
            <Icon name="content_cut" /> Split
          </button>
          <button onClick={() => onDuplicate(clip.id)}>
            <Icon name="content_copy" /> Duplicate
          </button>
          <button
            disabled={index === 0}
            onClick={() => onMove(clip.id, index - 1)}
            title="Move earlier"
          >
            <Icon name="arrow_back" />
          </button>
          <button
            disabled={index === resolved.length - 1}
            onClick={() => onMove(clip.id, index + 1)}
            title="Move later"
          >
            <Icon name="arrow_forward" />
          </button>
          <button className="danger" onClick={() => onRemove(clip.id)}>
            <Icon name="delete" /> Remove
          </button>
        </div>
      </div>
    </aside>
  );
};
