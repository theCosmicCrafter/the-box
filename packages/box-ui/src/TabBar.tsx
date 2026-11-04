// SPDX-License-Identifier: LicenseRef-Proprietary
// TabBar - Multi-board tab switcher for The Box.
// ADR-0013: Fast board switching across .canvas files in the workspace.

import { Icon } from "./icons.js";

export interface BoardTabItem {
  path: string;
  name: string;
}

export interface TabBarProps {
  boards: BoardTabItem[];
  activeBoardPath: string | null;
  onSelectBoard: (path: string) => void;
  onCloseBoard?: (path: string) => void;
  onNewBoard?: () => void;
}

export function TabBar(props: TabBarProps) {
  if (props.boards.length === 0) return null;

  return (
    <div className="tab-bar" role="tablist" aria-label="Open boards">
      <div className="tab-bar-list">
        {props.boards.map((b) => {
          const isActive = props.activeBoardPath === b.path;
          return (
            <div
              key={b.path}
              className={"tab-item" + (isActive ? " active" : "")}
              role="tab"
              aria-selected={isActive}
              onClick={() => props.onSelectBoard(b.path)}
              onAuxClick={(e) => {
                // Middle-click closes, matching browser tab convention.
                if (e.button === 1 && props.onCloseBoard) {
                  e.preventDefault();
                  props.onCloseBoard(b.path);
                }
              }}
              title={b.path}
            >
              <Icon name="board" size={14} />
              <span className="tab-title">{b.name}</span>
              {props.onCloseBoard && (
                <button
                  type="button"
                  className="tab-close"
                  title="Close board"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseBoard?.(b.path);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      {props.onNewBoard && (
        <button
          type="button"
          className="tab-new-btn"
          title="New board"
          onClick={props.onNewBoard}
        >
          <Icon name="filePlus" size={14} />
        </button>
      )}
    </div>
  );
}
