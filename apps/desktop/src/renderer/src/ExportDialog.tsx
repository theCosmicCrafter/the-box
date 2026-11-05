// SPDX-License-Identifier: LicenseRef-Proprietary
// ExportDialog.tsx - ADR-0013 canvas snapshot export modal: PNG
// (rasterized at 2x) or raw SVG, whole board or current selection.
// Format/scope state lives in the parent so a re-opened dialog keeps
// the last-used options; the dialog only owns rendering + the export.

import type { Board } from "@box/core";
import {
    exportBoardToSvg,
    exportSvgToPngBlob,
    Icon,
    triggerDownload,
} from "@box/ui";

export function ExportDialog(props: {
  board: Board;
  boardPath: string | null;
  selectedNodeIds: string[];
  format: "png" | "svg";
  onFormat: (f: "png" | "svg") => void;
  scope: "all" | "selected";
  onScope: (s: "all" | "selected") => void;
  onClose: () => void;
}) {
  const {
    board,
    boardPath,
    selectedNodeIds,
    format,
    onFormat,
    scope,
    onScope,
    onClose,
  } = props;

  const handleExport = async () => {
    const bName =
      boardPath?.split("/").pop()?.replace(/\.canvas$/, "") ??
      "canvas-export";
    const nodeIds =
      scope === "selected" && selectedNodeIds.length > 0
        ? selectedNodeIds
        : undefined;
    const svg = exportBoardToSvg(board, {
      nodeIds,
      padding: 40,
      background: "#0e1117",
    });
    if (format === "svg") {
      triggerDownload(svg, `${bName}.svg`);
    } else {
      const blob = await exportSvgToPngBlob(svg, 2);
      triggerDownload(blob, `${bName}.png`);
    }
    onClose();
  };

  return (
    <div
      className="help-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="export-modal">
        <h3>
          <Icon name="camera" size={18} />
          Export Canvas Snapshot
        </h3>
        <div className="export-options">
          <div className="export-row">
            <span>Format:</span>
            <div className="note-edge-pills">
              <button
                type="button"
                className={"note-pill" + (format === "png" ? " active" : "")}
                onClick={() => onFormat("png")}
              >
                PNG (High-Res 2x)
              </button>
              <button
                type="button"
                className={"note-pill" + (format === "svg" ? " active" : "")}
                onClick={() => onFormat("svg")}
              >
                SVG (Vector)
              </button>
            </div>
          </div>
          <div className="export-row">
            <span>Scope:</span>
            <div className="note-edge-pills">
              <button
                type="button"
                className={"note-pill" + (scope === "all" ? " active" : "")}
                onClick={() => onScope("all")}
              >
                All ({board.nodes.length} nodes)
              </button>
              <button
                type="button"
                className={
                  "note-pill" +
                  (scope === "selected" ? " active" : "") +
                  (selectedNodeIds.length === 0 ? " disabled" : "")
                }
                disabled={selectedNodeIds.length === 0}
                onClick={() => onScope("selected")}
              >
                Selection ({selectedNodeIds.length} nodes)
              </button>
            </div>
          </div>
        </div>
        <div className="export-actions">
          <button
            type="button"
            className="btn-tiny"
            style={{ padding: "6px 12px" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-tiny"
            style={{
              padding: "6px 14px",
              background: "#2563eb",
              borderColor: "#3b82f6",
              color: "#ffffff",
              fontWeight: 600,
            }}
            onClick={() => void handleExport()}
          >
            Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
