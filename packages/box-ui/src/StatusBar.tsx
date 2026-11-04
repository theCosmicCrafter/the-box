// SPDX-License-Identifier: LicenseRef-Proprietary
// StatusBar.tsx - bottom status strip: workspace/canvas stats on the
// left, zoom controls on the right. Stats come from store selectors;
// zoom commands flow back up as intent (the canvas owns the camera).

export interface StatusBarProps {
  /** Display zoom as a whole percent (camera.z * 100, rounded). */
  zoomPct: number;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  problemCount: number;
  selectedCount: number;
  onZoomIn?: (() => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  onZoomReset?: (() => void) | undefined;
  onZoomFit?: (() => void) | undefined;
}

export function StatusBar(props: StatusBarProps) {
  return (
    <div className="status-bar" role="contentinfo">
      <div className="status-bar-stats">
        <span title="Nodes on the open board">
          {props.nodeCount} node{props.nodeCount === 1 ? "" : "s"}
        </span>
        <span title="Arrows (link notes) on the open board">
          {props.edgeCount} edge{props.edgeCount === 1 ? "" : "s"}
        </span>
        <span title="Files in the workspace">
          {props.fileCount} file{props.fileCount === 1 ? "" : "s"}
        </span>
        {props.selectedCount > 0 && (
          <span>{props.selectedCount} selected</span>
        )}
        {props.problemCount > 0 && (
          <span className="status-bar-problems">
            {props.problemCount} problem{props.problemCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="status-bar-zoom">
        <button
          type="button"
          className="status-bar-btn"
          title="Zoom out"
          onClick={props.onZoomOut}
        >
          −
        </button>
        <button
          type="button"
          className="status-bar-btn status-bar-pct"
          title="Reset zoom to 100% (Shift+0)"
          onClick={props.onZoomReset}
        >
          {props.zoomPct}%
        </button>
        <button
          type="button"
          className="status-bar-btn"
          title="Zoom in"
          onClick={props.onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="status-bar-btn"
          title="Zoom to fit board (Shift+1)"
          onClick={props.onZoomFit}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
