// SPDX-License-Identifier: LicenseRef-Proprietary
// HelpModal - Keyboard shortcut cheatsheet & workflow guide for The Box.
// ADR-0013: Fast discoverability, accessible via '?' / F1 or Ribbon button.

import { useEffect, useState } from "react";
import { Icon } from "./icons.js";

export interface ShortcutItem {
  keys: string[];
  desc: string;
}

export interface ShortcutGroup {
  category: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: "Canvas Navigation & View",
    items: [
      { keys: ["Space", "Drag"], desc: "Pan canvas viewport" },
      { keys: ["Middle Click", "Drag"], desc: "Pan canvas viewport" },
      { keys: ["Mouse Wheel"], desc: "Smooth zoom in / out" },
      { keys: ["Shift", "1"], desc: "Fit all objects on canvas" },
      { keys: ["Shift", "0"], desc: "Reset camera to 100% zoom" },
      { keys: ["Shift", "2"], desc: "Zoom to fit selected objects" },
      { keys: ["MiniMap"], desc: "Click or drag red box to navigate" },
    ],
  },
  {
    category: "Selection & Organization",
    items: [
      { keys: ["Left Click", "Drag"], desc: "Marquee select multiple nodes" },
      { keys: ["Shift", "Click"], desc: "Toggle node in selection" },
      { keys: ["Ctrl", "A"], desc: "Select all nodes on board" },
      { keys: ["Arrow Keys"], desc: "Nudge selected nodes by 10px" },
      { keys: ["Delete"], desc: "Remove node placement (preserves file)" },
      { keys: ["Ctrl", "D"], desc: "Duplicate selected nodes & files" },
      { keys: ["Ctrl", "G"], desc: "Group selected nodes" },
      { keys: ["Ctrl", "Shift", "G"], desc: "Ungroup selected group" },
      { keys: ["Right Click (multi)"], desc: "Align, Distribute, or Tidy into Grid" },
    ],
  },
  {
    category: "Search & Intelligence",
    items: [
      { keys: ["Ctrl", "P"], desc: "QuickOpen palette (focus or place file)" },
      { keys: ["Ctrl", "F"], desc: "Canvas search & kind filter overlay" },
      { keys: ["Enter"], desc: "Cycle to next search match" },
      { keys: ["Shift", "Enter"], desc: "Cycle to previous search match" },
      { keys: ["Right Click", "Find related"], desc: "Local semantic vector similarity search" },
      { keys: ["Ctrl", "Z"], desc: "Undo canvas gesture or layout action" },
      { keys: ["Ctrl", "Y"], desc: "Redo canvas gesture or layout action" },
    ],
  },
  {
    category: "Node & File Interactions",
    items: [
      { keys: ["Double Click (Text/MD)"], desc: "Edit markdown text in place" },
      { keys: ["Double Click (Image)"], desc: "Open full-window PureRef/Eagle inspector" },
      { keys: ["Alt", "Double Click"], desc: "Reveal source file in Windows Explorer" },
      { keys: ["Drag Edge Handle"], desc: "Draw connection arrow between nodes" },
      { keys: ["Drag Edge to Canvas"], desc: "Spawn target note and connect edge" },
      { keys: ["Ctrl", "Shift", "E"], desc: "Export canvas snapshot (PNG / SVG)" },
    ],
  },
  {
    category: "Freehand Vector Inking",
    items: [
      { keys: ["Ribbon Pen"], desc: "Draw ink strokes (stored in .ink.svg)" },
      { keys: ["Ribbon Eraser"], desc: "Erase ink strokes" },
      { keys: ["Ribbon Move"], desc: "Select and move ink strokes" },
    ],
  },
];

export function HelpModal(props: {
  isOpen: boolean;
  onClose: () => void;
  /** In-app "Report an issue" affordance (copies diagnostics, opens tracker). */
  onReportIssue?: () => void;
}) {
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!props.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.isOpen, props.onClose]);

  if (!props.isOpen) return null;

  const q = filter.trim().toLowerCase();
  const filteredGroups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) =>
        q === "" ||
        item.desc.toLowerCase().includes(q) ||
        item.keys.some((k) => k.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      className="help-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="help-modal">
        <header className="help-modal-header">
          <div className="help-modal-title">
            <Icon name="help" size={18} />
            <h2>The Box Keyboard Shortcuts & Reference</h2>
          </div>
          <button
            className="help-modal-close"
            onClick={props.onClose}
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <div className="help-modal-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Filter shortcuts (e.g. zoom, group, align, export)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {filter && (
            <button className="help-modal-clear" onClick={() => setFilter("")}>
              ×
            </button>
          )}
        </div>

        {props.onReportIssue && (
          <div className="help-modal-report">
            <button
              type="button"
              className="help-report-btn"
              onClick={props.onReportIssue}
              title="Copies a diagnostics summary to the clipboard, then opens the issue tracker"
            >
              <Icon name="external" size={14} />
              Report an issue (copies diagnostics)
            </button>
          </div>
        )}
        <div className="help-modal-body">
          {filteredGroups.length === 0 ? (
            <div className="help-modal-empty">No shortcuts matching &ldquo;{filter}&rdquo;</div>
          ) : (
            filteredGroups.map((g) => (
              <section key={g.category} className="help-group">
                <h3>{g.category}</h3>
                <div className="help-items">
                  {g.items.map((item, idx) => (
                    <div key={idx} className="help-row">
                      <span className="help-desc">{item.desc}</span>
                      <span className="help-keys">
                        {item.keys.map((k, kIdx) => (
                          <kbd key={kIdx} className="help-kbd">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
