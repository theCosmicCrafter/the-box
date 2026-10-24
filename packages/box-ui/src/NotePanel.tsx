// SPDX-License-Identifier: LicenseRef-Proprietary
// NotePanel - the edge's meaning, editable. Selecting an edge opens its
// link-<id>.md here: frontmatter is facts (read-only), body + type are the
// human layer. Save writes the whole note back through the atomic IPC.

import type { CanvasEdge, LinkNote } from "@box/core";
import { lazy, Suspense, useEffect, useState } from "react";
import { NODE_COLOR_PRESETS } from "./canvas/NodeView.js";

// CodeMirror is ~350 kB of parse/highlight machinery the board never
// needs until a note opens - keep it out of the main chunk.
const CmBodyEditor = lazy(() =>
  import("./CmBodyEditor.js").then((m) => ({ default: m.CmBodyEditor })),
);

export interface NotePanelProps {
  note: LinkNote;
  edge?: CanvasEdge | undefined;
  /** True when the file changed on disk while the user was mid-edit. */
  stale?: boolean;
  onSave: (next: LinkNote) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Jump the canvas camera to an endpoint node (FR-205). */
  onJumpNode?: (nodeId: string) => void;
  /** Update edge visuals (color, lineStyle, fromEnd/toEnd). */
  onUpdateEdge?: (nextEdge: Partial<CanvasEdge>) => void;
  /** Erase this edge and move its link note to the Recycle Bin (I-2). */
  onDelete?: () => void;
}

export function NotePanel({
  note,
  edge,
  stale,
  onSave,
  onClose,
  onDirtyChange,
  onJumpNode,
  onUpdateEdge,
  onDelete,
}: NotePanelProps) {
  const [body, setBody] = useState(note.body);
  const [type, setType] = useState(
    typeof note.frontmatter["type"] === "string"
      ? (note.frontmatter["type"] as string)
      : "",
  );

  useEffect(() => {
    setBody(note.body);
    setType(
      typeof note.frontmatter["type"] === "string"
        ? (note.frontmatter["type"] as string)
        : "",
    );
  }, [note]);

  const dirty = body !== note.body || type !== (note.frontmatter["type"] ?? "");

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = () => {
    const fm = { ...note.frontmatter };
    if (type === "") delete fm["type"];
    else fm["type"] = type;
    onSave({ ...note, frontmatter: fm, body });
  };

  return (
    <aside className="note-panel">
      <header className="note-panel-head">
        <code>{note.path}</code>
        {stale && <span className="warn">changed on disk</span>}
        <button onClick={onClose} title="close">
          ×
        </button>
      </header>
      <dl className="note-panel-fm">
        <dt>edge</dt>
        <dd>
          <code>{note.frontmatter["box-edge"]}</code>
        </dd>
        <dt>from</dt>
        <dd>
          {onJumpNode ? (
            <button
              className="note-jump"
              title="Jump to source object"
              onClick={() => onJumpNode(note.frontmatter.from)}
            >
              <code>
                {note.frontmatter["from-file"] ?? note.frontmatter.from}
              </code>
            </button>
          ) : (
            <code>
              {note.frontmatter["from-file"] ?? note.frontmatter.from}
            </code>
          )}
        </dd>
        <dt>to</dt>
        <dd>
          {onJumpNode ? (
            <button
              className="note-jump"
              title="Jump to target object"
              onClick={() => onJumpNode(note.frontmatter.to)}
            >
              <code>{note.frontmatter["to-file"] ?? note.frontmatter.to}</code>
            </button>
          ) : (
            <code>{note.frontmatter["to-file"] ?? note.frontmatter.to}</code>
          )}
        </dd>
        <dt>created</dt>
        <dd>{note.frontmatter.created}</dd>
        <dt>type</dt>
        <dd>
          <input
            value={type}
            placeholder="supports / inspired-by / part-of …"
            onChange={(e) => setType(e.target.value)}
          />
        </dd>
        {edge && onUpdateEdge && (
          <>
            <dt>direction</dt>
            <dd className="note-edge-pills">
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.fromEnd !== "arrow" && edge.toEnd !== "none"
                    ? " active"
                    : "")
                }
                title="Unidirectional (forward arrow)"
                onClick={() =>
                  onUpdateEdge({ fromEnd: "none", toEnd: "arrow" })
                }
              >
                ➔ forward
              </button>
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.fromEnd === "arrow" && edge.toEnd === "arrow"
                    ? " active"
                    : "")
                }
                title="Bidirectional (arrows at both ends)"
                onClick={() =>
                  onUpdateEdge({ fromEnd: "arrow", toEnd: "arrow" })
                }
              >
                ↔ both
              </button>
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.fromEnd === "none" && edge.toEnd === "none"
                    ? " active"
                    : "")
                }
                title="Undirected line"
                onClick={() =>
                  onUpdateEdge({ fromEnd: "none", toEnd: "none" })
                }
              >
                — line
              </button>
            </dd>
            <dt>style</dt>
            <dd className="note-edge-pills">
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.lineStyle === undefined || edge.lineStyle === "solid"
                    ? " active"
                    : "")
                }
                onClick={() => onUpdateEdge({ lineStyle: "solid" })}
              >
                Solid
              </button>
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.lineStyle === "dashed" ? " active" : "")
                }
                onClick={() => onUpdateEdge({ lineStyle: "dashed" })}
              >
                Dashed
              </button>
              <button
                type="button"
                className={
                  "note-pill" +
                  (edge.lineStyle === "dotted" ? " active" : "")
                }
                onClick={() => onUpdateEdge({ lineStyle: "dotted" })}
              >
                Dotted
              </button>
            </dd>
            <dt>color</dt>
            <dd className="note-edge-swatches">
              <button
                type="button"
                className={"edge-swatch" + (!edge.color ? " active" : "")}
                style={{ backgroundColor: "#5a83c4" }}
                title="Default blue"
                onClick={() => onUpdateEdge({ color: undefined })}
              />
              {Object.entries(NODE_COLOR_PRESETS).map(([k, hex]) => (
                <button
                  key={k}
                  type="button"
                  className={
                    "edge-swatch" + (edge.color === k ? " active" : "")
                  }
                  style={{ backgroundColor: hex }}
                  title={`Color preset ${k}`}
                  onClick={() => onUpdateEdge({ color: k })}
                />
              ))}
            </dd>
          </>
        )}
      </dl>
      {/* FR-207: CM6 markdown editor for the body; frontmatter stays a
          structured read-only layer above, so box-edge is never editable. */}
      <div className="note-panel-body">
        <Suspense fallback={<div className="cm-body" aria-hidden />}>
          <CmBodyEditor
            doc={body}
            placeholder="What does this connection mean?"
            onDoc={setBody}
          />
        </Suspense>
      </div>
      <footer className="note-panel-foot">
        {onDelete && (
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            title="Erase edge and move link note to Recycle Bin (I-2)"
          >
            Delete link
          </button>
        )}
        <button onClick={save} disabled={!dirty}>
          Save note
        </button>
      </footer>
    </aside>
  );
}
