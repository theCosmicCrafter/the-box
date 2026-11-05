// SPDX-License-Identifier: LicenseRef-Proprietary
// RelatedNotesDialog.tsx - "Find related notes" results surface.
// Extracted from App.tsx; pure presentation - jump/link/close are
// callbacks so the semantic-search state stays in the shell.

import type { CanvasNode } from "@box/core";
import { baseName } from "@box/core";
import { Icon } from "@box/ui";

export interface RelatedResult {
  id: string;
  name: string;
  excerpt?: string | undefined;
  score: number;
}

export interface RelatedDialogData {
  sourceNode: CanvasNode;
  results: RelatedResult[];
}

export function RelatedNotesDialog(props: {
  dialog: RelatedDialogData;
  onClose: () => void;
  onJump: (nodeId: string) => void;
  onLink: (targetId: string) => void;
}) {
  const { dialog } = props;
  return (
    <div className="related-notes-dialog">
      <div className="related-notes-header">
        <span className="related-notes-title">
          <Icon name="search" size={16} />
          Related to{" "}
          {dialog.sourceNode.type === "file"
            ? baseName(dialog.sourceNode.file)
            : dialog.sourceNode.id}
        </span>
        <button
          type="button"
          className="related-notes-close"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      <div className="related-notes-list">
        {dialog.results.length === 0 ? (
          <div
            style={{
              color: "#8c97aa",
              fontSize: "12px",
              padding: "12px",
            }}
          >
            No strongly related notes found in this workspace.
          </div>
        ) : (
          dialog.results.map((r) => (
            <div key={r.id} className="related-note-item">
              <div className="related-note-info">
                <span className="related-note-name">{r.name}</span>
                {r.excerpt && (
                  <span className="related-note-excerpt">{r.excerpt}</span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span className="related-note-score">{r.score}%</span>
                <button
                  type="button"
                  className="btn-tiny"
                  title="Center camera on note"
                  onClick={() => props.onJump(r.id)}
                >
                  Jump
                </button>
                <button
                  type="button"
                  className="btn-tiny"
                  title="Connect with arrow"
                  onClick={() => props.onLink(r.id)}
                >
                  Link
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
