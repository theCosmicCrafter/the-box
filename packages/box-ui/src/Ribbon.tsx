// SPDX-License-Identifier: LicenseRef-Proprietary
// Ribbon - Obsidian's left icon strip: global workspace actions in a
// narrow always-visible column. Icons get tooltips via title; active
// states are left-border accents.

import { Icon } from "./icons.js";

export function Ribbon(props: {
  hasWorkspace: boolean;
  sidebarOpen: boolean;
  onOpenWorkspace?: () => void;
  onRescan?: () => void;
  onNewBoard?: () => void;
  onToggleSidebar?: () => void;
}) {
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
