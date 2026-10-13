// SPDX-License-Identifier: LicenseRef-Proprietary
// NotePanel - the edge's meaning, editable. Selecting an edge opens its
// link-<id>.md here: frontmatter is facts (read-only), body + type are the
// human layer. Save writes the whole note back through the atomic IPC.

import type { LinkNote } from "@box/core";
import { useEffect, useState } from "react";

export interface NotePanelProps {
  note: LinkNote;
  /** True when the file changed on disk while the user was mid-edit. */
  stale?: boolean;
  onSave: (next: LinkNote) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Jump the canvas camera to an endpoint node (FR-205). */
  onJumpNode?: (nodeId: string) => void;
}

export function NotePanel({
  note,
  stale,
  onSave,
  onClose,
  onDirtyChange,
  onJumpNode,
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
      </dl>
      <textarea
        className="note-panel-body"
        value={body}
        placeholder="What does this connection mean?"
        onChange={(e) => setBody(e.target.value)}
        rows={10}
      />
      <footer className="note-panel-foot">
        <button onClick={save} disabled={!dirty}>
          Save note
        </button>
      </footer>
    </aside>
  );
}
