// SPDX-License-Identifier: LicenseRef-Proprietary
// Ribbon - Obsidian's left icon strip: global workspace actions in a
// narrow always-visible column. Icons get tooltips via title; active
// states are left-border accents.

import { Icon } from "./icons.js";

export const INK_COLORS = [
  "#e8b931",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f8fafc",
] as const;

export const INK_SIZES = [4, 10, 18] as const;

export function Ribbon(props: {
  hasWorkspace: boolean;
  sidebarOpen: boolean;
  /** A board is open - ink tools apply to its file nodes. */
  boardOpen?: boolean | undefined;
  inkMode?: "off" | "draw" | "erase" | "edit" | undefined;
  onInkMode?: ((mode: "off" | "draw" | "erase" | "edit") => void) | undefined;
  inkColor?: string | undefined;
  onInkColor?: ((color: string) => void) | undefined;
  inkSize?: number | undefined;
  onInkSize?: ((size: number) => void) | undefined;
  onOpenWorkspace?: (() => void) | undefined;
  onRescan?: (() => void) | undefined;
  onNewBoard?: (() => void) | undefined;
  onToggleSidebar?: (() => void) | undefined;
  /** Zoom-to-fit the whole board (Obsidian: Shift+1). */
  onZoomFit?: (() => void) | undefined;
  /** Canvas search and filter overlay toggle (Ctrl+F). */
  filterOpen?: boolean | undefined;
  onToggleFilter?: (() => void) | undefined;
  /** FR-306: spatial audio mode; click cycles off -> all -> viewport. */
  audioMode?: "off" | "all" | "viewport" | undefined;
  onAudioMode?: ((mode: "off" | "all" | "viewport") => void) | undefined;
}) {
  const activeColor = props.inkColor ?? INK_COLORS[0];
  const activeSize = props.inkSize ?? INK_SIZES[1];
  return (
    <nav className="ribbon" aria-label="workspace actions">
      <button
        className="ribbon-btn"
        title="Open workspace folder"
        onClick={props.onOpenWorkspace}
      >
        <Icon name="folderOpen" size={18} />
      </button>
      {props.hasWorkspace && (
        <>
          <button
            className="ribbon-btn"
            title="Rescan workspace"
            onClick={props.onRescan}
          >
            <Icon name="refresh" size={18} />
          </button>
          <button
            className="ribbon-btn"
            title="New board"
            onClick={props.onNewBoard}
          >
            <Icon name="filePlus" size={18} />
          </button>
          <div className="ribbon-gap" />
          {props.boardOpen && (
            <>
              <button
                className={
                  "ribbon-btn" +
                  (props.inkMode === "draw" ? " ribbon-active" : "")
                }
                title={
                  props.inkMode === "draw"
                    ? "Ink: drawing (click to stop)"
                    : "Draw ink over objects"
                }
                onClick={() =>
                  props.onInkMode?.(props.inkMode === "draw" ? "off" : "draw")
                }
              >
                <Icon name="pen" size={18} />
              </button>
              <button
                className={
                  "ribbon-btn" +
                  (props.inkMode === "erase" ? " ribbon-active" : "")
                }
                title={
                  props.inkMode === "erase"
                    ? "Ink: erasing (click to stop)"
                    : "Erase ink strokes"
                }
                onClick={() =>
                  props.onInkMode?.(props.inkMode === "erase" ? "off" : "erase")
                }
              >
                <Icon name="eraser" size={18} />
              </button>
              <button
                type="button"
                className={
                  "ribbon-btn" + (props.inkMode === "edit" ? " active" : "")
                }
                title="Ink select/move - drag a stroke to reposition it"
                onClick={() =>
                  props.onInkMode?.(props.inkMode === "edit" ? "off" : "edit")
                }
              >
                <Icon name="move" size={18} />
              </button>
              {props.inkMode === "draw" && (
                <div className="ribbon-ink-palette" aria-label="ink options">
                  {INK_COLORS.map((c) => {
                    const active = activeColor === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={"ribbon-swatch" + (active ? " active" : "")}
                        style={{ backgroundColor: c }}
                        title={`Ink color ${c}`}
                        onClick={() => props.onInkColor?.(c)}
                      />
                    );
                  })}
                  {INK_SIZES.map((s) => {
                    const active = activeSize === s;
                    const d = Math.max(3, Math.round(s * 0.55));
                    return (
                      <button
                        key={s}
                        type="button"
                        className={"ribbon-size" + (active ? " active" : "")}
                        title={`Stroke width ${s}px`}
                        onClick={() => props.onInkSize?.(s)}
                      >
                        <span
                          className="ribbon-size-dot"
                          style={{ width: d, height: d }}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="ribbon-gap" />
            </>
          )}
          {props.boardOpen && (
            <button
              className="ribbon-btn"
              title="Zoom to fit all objects (Shift+1)"
              onClick={props.onZoomFit}
            >
              <Icon name="maximize" size={18} />
            </button>
          )}
          {props.boardOpen && (
            <button
              className={
                "ribbon-btn" + (props.filterOpen ? " ribbon-active" : "")
              }
              title="Search and filter canvas (Ctrl+F)"
              onClick={props.onToggleFilter}
            >
              <Icon name="search" size={18} />
            </button>
          )}
          {props.boardOpen && (
            <button
              className={
                "ribbon-btn" +
                (props.audioMode !== undefined && props.audioMode !== "off"
                  ? " ribbon-active"
                  : "")
              }
              title={`Spatial audio: ${props.audioMode ?? "off"} (click to cycle off/all/viewport)`}
              onClick={() => {
                const next =
                  props.audioMode === "all"
                    ? "viewport"
                    : props.audioMode === "viewport"
                      ? "off"
                      : "all";
                props.onAudioMode?.(next);
              }}
            >
              <Icon name="volume" size={18} />
            </button>
          )}
          <button
            className={
              "ribbon-btn" + (props.sidebarOpen ? " ribbon-active" : "")
            }
            title={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={props.onToggleSidebar}
          >
            <Icon name="panelLeft" size={18} />
          </button>
        </>
      )}
    </nav>
  );
}
