// SPDX-License-Identifier: LicenseRef-Proprietary
// CanvasFilter - search & filter overlay bar for the canvas.
// Supports full-text search, file extension filtering, and kind toggles
// with visual match navigation (Enter / Shift+Enter).

import { fileKind, type CanvasNode, type FileKind } from "@box/core";
import { useEffect, useRef } from "react";
import { Icon } from "../icons.js";

export type FilterKind = "all" | "image" | "text" | "audio" | "model3d" | "video";

export interface CanvasFilterProps {
  query: string;
  onQueryChange: (query: string) => void;
  selectedKind: FilterKind;
  onSelectKind: (kind: FilterKind) => void;
  matchCount: number;
  totalCount: number;
  activeIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onClose: () => void;
}

export function matchNode(
  node: CanvasNode,
  query: string,
  kindFilter: FilterKind,
  fileTexts?: ReadonlyMap<string, string>,
): boolean {
  if (kindFilter !== "all") {
    if (node.type === "text") {
      if (kindFilter !== "text") return false;
    } else if (node.type === "file") {
      const override = node["box-media"]?.kind;
      const k: FileKind | null =
        (override === "doc" ? "text" : override) ?? fileKind(node.file);
      if (kindFilter === "text") {
        if (k !== "text" && k !== "code" && k !== "document" && k !== "pdf")
          return false;
      } else if (k !== kindFilter) {
        return false;
      }
    } else {
      return false;
    }
  }

  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;

  if (q.startsWith(".")) {
    if (node.type !== "file") return false;
    return node.file.toLowerCase().endsWith(q);
  }

  if (node.type === "file") {
    if (node.file.toLowerCase().includes(q)) return true;
    const excerpt = fileTexts?.get(node.file);
    if (excerpt && excerpt.toLowerCase().includes(q)) return true;
  }

  if (node.type === "text" && typeof node.text === "string") {
    if (node.text.toLowerCase().includes(q)) return true;
  }

  if (node.type === "link") {
    if (typeof node.url === "string" && node.url.toLowerCase().includes(q))
      return true;
    if (typeof node.label === "string" && node.label.toLowerCase().includes(q))
      return true;
  }

  if (node.type === "group" && typeof node.label === "string") {
    if (node.label.toLowerCase().includes(q)) return true;
  }

  return false;
}

export function CanvasFilter(props: CanvasFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const kinds: { id: FilterKind; label: string }[] = [
    { id: "all", label: "All" },
    { id: "image", label: "Images" },
    { id: "text", label: "Docs" },
    { id: "model3d", label: "3D" },
    { id: "audio", label: "Audio" },
    { id: "video", label: "Video" },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        props.onPrevMatch();
      } else {
        props.onNextMatch();
      }
    }
  };

  const hasFilter = props.query.trim().length > 0 || props.selectedKind !== "all";

  return (
    <div className="canvas-filter-overlay">
      <div className="canvas-filter-input-wrap">
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          type="text"
          className="canvas-filter-input"
          placeholder="Filter canvas (filename, text, .ext)…"
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {hasFilter && (
          <span className="canvas-filter-count">
            {props.matchCount === 0
              ? "0 matches"
              : `${props.activeIndex + 1} of ${props.matchCount}`}
          </span>
        )}
        <div className="canvas-filter-nav">
          <button
            type="button"
            className="canvas-filter-nav-btn"
            title="Previous match (Shift+Enter)"
            disabled={props.matchCount === 0}
            onClick={props.onPrevMatch}
          >
            ▲
          </button>
          <button
            type="button"
            className="canvas-filter-nav-btn"
            title="Next match (Enter)"
            disabled={props.matchCount === 0}
            onClick={props.onNextMatch}
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          className="canvas-filter-close-btn"
          title="Close filter (Esc)"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>

      <div className="canvas-filter-pills">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            className={
              "canvas-filter-pill" +
              (props.selectedKind === k.id ? " active" : "")
            }
            onClick={() => props.onSelectKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
