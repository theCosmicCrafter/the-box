// SPDX-License-Identifier: LicenseRef-Proprietary
// BoxPanel - "The Box" holding area (FR-202). Every workspace file that is a
// user object but not placed on the open board lists here. Interactions:
//   - drag a row onto the canvas (same x-box-file payload as FileTree)
//   - click a row -> pick-up mode: the file follows the cursor, click empty
//     canvas to place, Esc cancels (Obsidian Canvas Positioning Toolkit
//     pattern)
//   - "place" button drops the file at the current viewport center
//   - "place all" lays every unplaced file out on a deterministic grid
// Files stay truth in all paths: placing only writes a board node.

import { fileIcon, isBoxUserObject } from "./FileTree.js";
import { Icon } from "./icons.js";
import type { WorkspaceFile } from "./store.js";

export function BoxPanel(props: {
  files: WorkspaceFile[];
  placedPaths: Set<string>;
  /** Ink sidecars currently bound to a file node - shown with a badge. */
  boundInkPaths?: Set<string> | undefined;
  /** File the user picked up - highlighted; click empty canvas to drop. */
  pickedUp?: string | null | undefined;
  onPickUp?: ((path: string) => void) | undefined;
  /** Place one file (platform chooses the spot - viewport center). */
  onPlace?: ((path: string) => void) | undefined;
  /** Place every listed file on a deterministic grid. */
  onPlaceAll?: ((paths: string[]) => void) | undefined;
}) {
  // FR-307: `.ink.svg` sidecars are real objects - they list here even
  // when bound to a parent node (badged), so they can be placed and
  // linked independently.
  const unplaced = props.files.filter(
    (f) => isBoxUserObject(f.path) && !props.placedPaths.has(f.path),
  );
  return (
    <section className="box-panel" aria-label="The Box - unplaced objects">
      <header className="box-panel-head">
        <Icon name="box" size={14} />
        <span className="box-panel-title">The Box</span>
        <span className="box-panel-count">{unplaced.length}</span>
        {unplaced.length > 0 && props.onPlaceAll && (
          <button
            type="button"
            className="box-panel-placeall"
            title="Place every unplaced file as a grid on the board"
            onClick={() => props.onPlaceAll?.(unplaced.map((f) => f.path))}
          >
            place all
          </button>
        )}
      </header>
      {unplaced.length === 0 ? (
        <p className="box-panel-empty">Everything is on the board.</p>
      ) : (
        <ul className="box-panel-list">
          {unplaced.map((f) => (
            <li
              key={f.path}
              className={
                "box-panel-item" +
                (props.pickedUp === f.path ? " picked-up" : "")
              }
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-box-file", f.path);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => props.onPickUp?.(f.path)}
              title={`${f.path} - click to pick up, drag to place`}
            >
              <Icon name={fileIcon(f.path)} size={14} />
              <span className="box-panel-name">{f.path}</span>
              {props.boundInkPaths?.has(f.path) && (
                <span className="box-panel-badge" title="Bound ink overlay">
                  ink
                </span>
              )}
              {props.onPlace && (
                <button
                  type="button"
                  className="box-panel-place"
                  title="Place at viewport center"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onPlace?.(f.path);
                  }}
                >
                  +
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
