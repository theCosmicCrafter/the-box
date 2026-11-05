// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 1 shell: workspace file list + board canvas + link-note panel.
// Composition root only - domain logic lives in the use* hooks beside
// this file (board lifecycle, node ops, link notes, ink, prefs, watcher,
// shortcuts, filter, semantic search, layout, undo). The canvas is a
// projection; files on disk remain the source of truth.

import type { CanvasNode, ProblemItem } from "@box/core";
import { baseName, fileKind, serializeBoard } from "@box/core";
import type { Camera, MenuSpec } from "@box/ui";
import {
    BoardView,
    BoxPanel,
    CanvasFilter,
    ContextMenu,
    DEFAULT_CAMERA,
    FileTree,
    HelpModal,
    Icon,
    ImageInspector,
    NotePanel,
    QuickOpen,
    Ribbon,
    screenToWorld,
    StatusBar,
    TabBar,
    useBoxStore,
} from "@box/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { boxPlatform } from "./bridge.js";
import { ExportDialog } from "./ExportDialog.js";
import { buildCanvasMenu, buildNodeMenu, buildTreeMenu, type MenuDeps } from "./menus.js";
import { RelatedNotesDialog } from "./RelatedNotesDialog.js";
import { useBoardLifecycle } from "./useBoardLifecycle.js";
import { useBoardShortcuts } from "./useBoardShortcuts.js";
import { useCanvasFilter } from "./useCanvasFilter.js";
import { useFileExcerpts } from "./useFileExcerpts.js";
import { useInkOverlay } from "./useInkOverlay.js";
import { useLayoutOps } from "./useLayoutOps.js";
import { useLinkNotes } from "./useLinkNotes.js";
import { useNodeOps } from "./useNodeOps.js";
import { useSemanticSearch } from "./useSemanticSearch.js";
import { useUndoStack } from "./useUndoStack.js";
import { useWorkspacePrefs } from "./useWorkspacePrefs.js";
import { useWorkspaceWatcher } from "./useWorkspaceWatcher.js";

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

export function App() {
  const {
    workspaceRoot,
    files,
    board,
    boardPath,
    boardProblems,
    problems,
    sidebarOpen,
    setSidebarOpen,
    setFiles,
    closeBoard,
    moveNode,
    addNode,
    removeNode,
    updateNode,
    addEdge,
    restoreBoard,
  } = useBoxStore();

  // ADR-0007: session undo/redo stacks + oplog persistence live in
  // useUndoStack.ts; refs keep the same `.current` access at call sites.
  const {
    undoStack,
    redoStack,
    gestureDirty,
    captureUndo,
    seedOplog,
    scheduleOplogFlush,
  } = useUndoStack();
  const moveNodeC = (id: string, x: number, y: number) => {
    captureUndo();
    moveNode(id, x, y);
  };
  const addNodeC = (n: CanvasNode) => {
    captureUndo();
    addNode(n);
  };
  const removeNodeC = (id: string) => {
    captureUndo();
    removeNode(id);
  };
  const updateNodeC = (id: string, patch: Record<string, unknown>) => {
    captureUndo();
    updateNode(id, patch);
  };

  const saveBoard = async () => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath || !window.box) return;
    await window.box.writeFileAtomic(
      workspaceRoot,
      boardPath,
      serializeBoard(b),
    );
    gestureDirty.current = false;
  };

  const rescan = async () => {
    if (workspaceRoot && window.box) {
      setFiles(await window.box.rescan(workspaceRoot));
    }
  };

  // Ink mode + .ink.svg sidecar ops live in useInkOverlay.ts.
  const {
    inkMode,
    setInkMode,
    inkColor,
    setInkColor,
    inkSize,
    setInkSize,
    inkMap,
    setInkMap,
    lastInkNode,
    reloadInk,
    inkStroke,
    inkStrokeMove,
    inkUndo,
    inkErase,
  } = useInkOverlay({ workspaceRoot, board, updateNodeC, saveBoard });

  // "Arrows are notes" kernel - edge/link-note ops, endpoint-authority
  // sync (R-B), and the ADR-0010 proposal layer live in useLinkNotes.ts.
  const {
    edgeNote,
    setEdgeNote,
    linkProposal,
    noteStale,
    setNoteStale,
    noteDirty,
    decisionClient,
    selectEdge,
    deleteEdge,
    retargetEdge,
    saveNote,
    createEdge,
    healChangedEdgeNotes,
    handleUpdateEdge,
    confirmLinkProposal,
    dismissLinkProposal,
  } = useLinkNotes({
    workspaceRoot,
    boardPath,
    saveBoard,
    rescan,
    captureUndo,
  });

  // Camera/viewport handles shared by node ops, prefs' audio tick, OS
  // drops, and the pick-up overlay's screen-to-world conversion.
  const camRef = useRef<Camera>(DEFAULT_CAMERA);
  const vpElRef = useRef<HTMLDivElement | null>(null);

  // App-owned UI state: dialogs, overlays, selection, zoom plumbing.
  // FR-202 pick-up mode: a Box row's file follows the cursor until the
  // user clicks the canvas to place it (or Esc cancels).
  const [pickUp, setPickUp] = useState<string | null>(null);
  // Shift+1 zoom-to-fit request.
  const [fitAll, setFitAll] = useState<{ nonce: number } | null>(null);
  // Status-bar zoom: camera changes stream through onCameraChange; the
  // readout is throttled so a zoom gesture doesn't re-render per frame.
  const [zoomPct, setZoomPct] = useState(100);
  const zoomPctAt = useRef(0);
  const [zoomRequest, setZoomRequest] = useState<{
    action: "in" | "out" | "reset";
    nonce: number;
  } | null>(null);
  const zoomNonce = useRef(0);
  const requestZoom = (action: "in" | "out" | "reset") =>
    setZoomRequest({ action, nonce: ++zoomNonce.current });
  // FR-205: camera-jump request (nonce re-fires when the same node is
  // jumped to twice in a row).
  const [focusNode, setFocusNode] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const jumpToNode = (id: string) => setFocusNode({ id, nonce: Date.now() });
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  // Image inspector (PureRef/Eagle): the file path currently inspected.
  const [inspectPath, setInspectPath] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "svg">("png");
  const [exportScope, setExportScope] = useState<"all" | "selected">("all");

  // Non-truth prefs (.box/settings.json): ink, audio, open-with, the
  // decision client, plus the spatial-audio rAF tick and open-external.
  const {
    openWithMap,
    setOpenWithMap,
    audioMode,
    savePrefs,
    loadPrefs,
    setInkColorPref,
    setInkSizePref,
    setAudioModePref,
    openExternalSmart,
  } = useWorkspacePrefs({
    decisionClient,
    setInkColor,
    setInkSize,
    inkColor,
    inkSize,
    camRef,
    vpElRef,
    boardNodes: board?.nodes,
  });

  // Workspace open/restore, board-file load, scaffold, new board.
  const {
    open,
    loadBoardFile,
    scaffoldOffered,
    scaffold,
    newBoard,
    newBoardName,
    setNewBoardName,
    newBoardInput,
  } = useBoardLifecycle({ rescan, seedOplog, loadPrefs });

  // File excerpts + sizes live in useFileExcerpts.ts (keyed loader).
  const { fileTexts, setFileTexts, fileSizes } = useFileExcerpts({
    workspaceRoot,
    board,
    files,
  });

  // Node lifecycle ops: create/place/import/paste/delete/group/duplicate,
  // arrow-drop edge+node, in-place file editing, OS file drop.
  const {
    editingNode,
    fileEdit,
    setFileEdit,
    createTextNode,
    placeFile,
    placeFiles,
    placeAtViewCenter,
    quickOpenPick,
    placeAllGrid,
    importAndPlace,
    pasteAt,
    pasteAtCenter,
    dropEdgeAt,
    deleteNode,
    deleteNodes,
    groupSelection,
    ungroupSelection,
    duplicateNodes,
    commitText,
    startFileEdit,
    commitFileEdit,
  } = useNodeOps({
    saveBoard,
    rescan,
    addNodeC,
    removeNodeC,
    updateNodeC,
    addEdge,
    fileTexts,
    setFileTexts,
    camRef,
    vpElRef,
    jumpToNode,
  });

  // Track 4: Canvas Search & Filter Overlay.
  const {
    filterOpen,
    setFilterOpen,
    filterQuery,
    setFilterQuery,
    filterKind,
    setFilterKind,
    filterMatchIdx,
    matchedNodeIds,
    dimmedNodes,
    nextFilterMatch,
    prevFilterMatch,
  } = useCanvasFilter({ board, fileTexts, jumpToNode });

  // Track 3: Local Semantic Intelligence (ADR-0012).
  const { relatedDialog, setRelatedDialog, findRelated } = useSemanticSearch({
    fileTexts,
  });

  // Track 1: Layout & Tidy Tools (pure user-invoked, Invariant I-9 compliant).
  const { runAlign, runDistribute, runTidyGrid } = useLayoutOps({
    captureUndo,
    gestureDirty,
    saveBoard,
  });

  const undo = async () => {
    const snap = undoStack.current.pop();
    const b = useBoxStore.getState().board;
    if (snap === undefined || b === null) return;
    redoStack.current.push({ nodes: b.nodes, edges: b.edges });
    gestureDirty.current = false;
    restoreBoard(snap.nodes, snap.edges);
    await healChangedEdgeNotes(b.edges, snap.edges, snap);
    await saveBoard();
    scheduleOplogFlush();
  };
  const redo = async () => {
    const snap = redoStack.current.pop();
    const b = useBoxStore.getState().board;
    if (snap === undefined || b === null) return;
    undoStack.current.push({ nodes: b.nodes, edges: b.edges });
    gestureDirty.current = false;
    restoreBoard(snap.nodes, snap.edges);
    await healChangedEdgeNotes(b.edges, snap.edges, snap);
    await saveBoard();
    scheduleOplogFlush();
  };

  // The round-trip half of the wedge: whatever the watcher reports, apply
  // it. remote = reconcile-authoritative broken sets.
  const { remote } = useWorkspaceWatcher({
    edgeNotePath: edgeNote?.path,
    noteDirty,
    setEdgeNote,
    setNoteStale,
    fileTexts,
    setFileTexts,
    setInspectPath,
    reloadInk,
  });

  // Global keys: Shift+1 zoom-to-fit, Esc unwinds dialogs in z-order,
  // Ctrl+Z pops the last ink stroke while an ink mode is active.
  useBoardShortcuts({
    pickUp,
    setPickUp,
    filterOpen,
    setFilterOpen,
    relatedDialog,
    setRelatedDialog,
    helpOpen,
    setHelpOpen,
    exportOpen,
    setExportOpen,
    setFitAll,
    setQuickOpen,
    inkMode,
    lastInkNode,
    inkUndo,
    undo,
    redo,
  });

  // CDP verification handle (tools/cdp-eval.mjs drives real assertions).
  useEffect(() => {
    (window as unknown as { __boxStore: typeof useBoxStore }).__boxStore =
      useBoxStore;
  }, []);

  // Problem rows are `kind: path - detail`. Clicking locates the object:
  // first look for any board edge/node whose id/file/sidecar appears anywhere in
  // the message (detail text carries the interesting path, e.g. "file
  // missing: x.txt" or "edge 0000000000000064 dangling endpoint");
  // fall back to the headline path. A board path opens that board.
  const locateProblem = (p: string) => {
    const b = useBoxStore.getState().board;
    if (b) {
      const edgeHit = b.edges.find((e) => p.includes(e.id));
      if (edgeHit) {
        selectEdge(edgeHit.id);
        const surviving = b.nodes.find(
          (n) => n.id === edgeHit.fromNode || n.id === edgeHit.toNode,
        );
        if (surviving) jumpToNode(surviving.id);
        return;
      }

      const hit = b.nodes.find((n) => {
        if (n.type === "file")
          return (
            p.includes(n.file) ||
            (typeof n["box-ink"] === "string" && p.includes(n["box-ink"]))
          );
        return p.includes(n.id);
      });
      if (hit) {
        jumpToNode(hit.id);
        return;
      }
    }
    const m = /^[^:]+:\s([^-]+?)(?:\s-\s|$)/.exec(p);
    const path = m?.[1]?.trim();
    if (path?.endsWith(".canvas")) void loadBoardFile(path);
  };

  // Context menus are declarations in menus.ts; menuDeps captures the
  // live callbacks once per render (defined after every dep exists).
  const menuDeps: MenuDeps = {
    openMenu: setMenu,
    updateNodeC,
    updateNode,
    removeNodeC,
    saveBoard,
    rescan,
    loadBoardFile,
    deleteNode,
    deleteNodes,
    groupSelection,
    duplicateNodes,
    runAlign,
    runDistribute,
    runTidyGrid,
    findRelated,
    openExternalSmart,
    startFileEdit,
    setInspectPath,
    openWithMap,
    setOpenWithMap,
    savePrefs,
    inkMap,
    setInkMap,
    createTextNode,
    placeFile,
    importAndPlace,
    pasteAt,
  };
  const canvasMenu = (wx: number, wy: number, cx: number, cy: number) =>
    setMenu({ x: cx, y: cy, items: buildCanvasMenu(menuDeps, wx, wy) });
  const treeMenu = (path: string, isDir: boolean, x: number, y: number) => {
    const items = buildTreeMenu(menuDeps, path, isDir);
    if (items !== null) setMenu({ x, y, items });
  };
  const nodeMenu = (
    node: CanvasNode,
    cx: number,
    cy: number,
    selectedIds?: string[],
  ) =>
    setMenu({
      x: cx,
      y: cy,
      items: buildNodeMenu(menuDeps, node, cx, cy, selectedIds),
    });

  // Media URL through the box:// protocol (main validates inside root).
  // ?v=<mtime> is Obsidian's cache-buster: an external edit bumps mtime and
  // the URL changes, so <img>/<video> re-fetch instead of serving a stale
  // cache entry. Windows custom schemes serve at https://box.localhost
  // (WebView2 limitation - ADR-0006); elsewhere real box://.
  const resolveMedia = (rel: string) => {
    const mtime = files.find((f) => f.path === rel)?.mtime;
    const v = mtime === undefined ? "" : `?v=${Math.floor(mtime)}`;
    const enc = encodeURIComponent(rel);
    return boxPlatform === "windows"
      ? `https://box.localhost/f/${enc}${v}`
      : `box://f/${enc}${v}`;
  };

  // Typed tiles get the OS-associated icon (cached PNG under .box/icons).
  const resolveIcon = async (rel: string) => {
    const r = await window.box?.fileIcon(rel);
    return r?.ok && r.path ? resolveMedia(r.path) : null;
  };

  // Typed tiles try a shell thumbnail first: real content (video frames,
  // codec-installed heic/raw, blender's registered handler) over icons.
  const resolveThumb = async (rel: string) => {
    const r = await window.box?.fileThumb(rel);
    return r?.ok && r.path ? resolveMedia(r.path) : null;
  };

  // FR-202: the sidebar "unplaced" filter needs the set of files already
  // on the open board.
  const placedPaths = useMemo(
    () =>
      new Set(
        (board?.nodes ?? [])
          .filter((n) => n.type === "file")
          .map((n) => (n.type === "file" ? n.file : "")),
      ),
    [board?.nodes],
  );
  const boundInkPaths = useMemo(
    () =>
      new Set(
        (board?.nodes ?? [])
          .filter((n) => n.type === "file" && typeof n["box-ink"] === "string")
          .map((n) => (n.type === "file" ? (n["box-ink"] as string) : "")),
      ),
    [board?.nodes],
  );

  // ADR-0013: Multi-board tabs
  const boardTabs = useMemo(() => {
    return files
      .filter((f) => f.path.endsWith(".canvas"))
      .map((f) => ({
        path: f.path,
        name: f.path.split("/").pop()?.replace(/\.canvas$/, "") ?? f.path,
      }));
  }, [files]);

  // Broken-file detection: file nodes whose target isn't in the workspace.
  const brokenNodes = useMemo(() => {
    const have = new Set(files.map((f) => f.path));
    const missing = new Set(remote?.brokenNodes ?? []);
    for (const n of board?.nodes ?? []) {
      if (n.type === "file" && !have.has(n.file)) missing.add(n.id);
    }
    return missing;
  }, [board, files, remote]);

  // Obsidian-model shell: ribbon (global actions) + sidebar (vault tree,
  // persistent) + content (board or welcome). The sidebar stays mounted
  // beside the board so tree-to-canvas drag never leaves the view.
  const boardPane =
    board && boardPath ? (
      <div className="board-shell">
        {/* nothing-but-canvas: chrome floats over the canvas, no bar */}
        <div className="board-float">
          {(boardProblems.length > 0 || brokenNodes.size > 0) && (
            <span
              className="warn"
              title={[
                ...boardProblems.map(fmtProblem),
                ...[...brokenNodes].map((id) => {
                  const n = board.nodes.find((x) => x.id === id);
                  return `missing: ${n?.type === "file" ? n.file : id}`;
                }),
              ].join("\n")}
            >
              {boardProblems.length + brokenNodes.size} issues
            </span>
          )}
          <button
            className="board-close"
            onClick={closeBoard}
            title="Close board"
          >
            x
          </button>
        </div>
        <div className="board-body">
          <BoardView
            key={boardPath}
            board={board}
            selectedEdge={edgeNote?.frontmatter["box-edge"] ?? null}
            dimmedNodes={dimmedNodes}
            brokenNodes={brokenNodes}
            brokenEdges={remote?.brokenEdges}
            fileTexts={fileTexts}
            fileSizes={fileSizes}
            editingNode={editingNode}
            inkMode={inkMode}
            inkColor={inkColor}
            inkSize={inkSize}
            inkByNodeId={inkMap}
            fileEdit={
              fileEdit ? { nodeId: fileEdit.nodeId, text: fileEdit.text } : null
            }
            focusNode={focusNode}
            fitAllRequest={fitAll ?? undefined}
            onInkStroke={(id, pts) => void inkStroke(id, pts)}
            onInkErase={(id, x, y) => void inkErase(id, x, y)}
            onInkStrokeMove={(id, i, dx, dy) =>
              void inkStrokeMove(id, i, dx, dy)
            }
            onEditFile={(n) => void startFileEdit(n)}
            onFileCommit={(id, t) => void commitFileEdit(id, t)}
            onFileEditCancel={() => setFileEdit(null)}
            resolveMedia={resolveMedia}
            resolveIcon={resolveIcon}
            resolveThumb={resolveThumb}
            onMove={moveNodeC}
            onResize={(id, w, h) => updateNodeC(id, { width: w, height: h })}
            onCommit={() => void saveBoard()}
            onTextCommit={(id, t) => void commitText(id, t)}
            onDeleteNode={(id) => void deleteNode(id)}
            onDeleteNodes={(ids) => void deleteNodes(ids)}
            onGroup={(ids) => void groupSelection(ids)}
            onUngroup={(ids) => void ungroupSelection(ids)}
            onDuplicate={(ids) => void duplicateNodes(ids)}
            onPasteRequest={() => void pasteAtCenter()}
            onCreateEdge={(f, t, fs, ts) => void createEdge(f, t, fs, ts)}
            onRetargetEdge={(id, end, nid, side) =>
              void retargetEdge(id, end, nid, side)
            }
            onDeleteEdge={(id) => void deleteEdge(id)}
            onSelectEdge={(id) => void selectEdge(id)}
            onSelectionChange={setSelectedNodeIds}
            onDropFile={(p, x, y) => void placeFile(p, x, y)}
            onEmptyDoubleClick={(x, y) => void createTextNode(x, y)}
            onCanvasMenu={canvasMenu}
            onNodeMenu={nodeMenu}
            onCameraChange={(c) => {
              camRef.current = c;
              const now = performance.now();
              if (now - zoomPctAt.current < 120) return;
              zoomPctAt.current = now;
              const z = Math.round(c.z * 100);
              setZoomPct((p) => (p === z ? p : z));
            }}
            zoomRequest={zoomRequest ?? undefined}
            viewportRef={vpElRef}
            onDropEdgeAt={(f, s, x, y) => void dropEdgeAt(f, s, x, y)}
            linkProposal={linkProposal}
            onLinkProposalConfirm={() => void confirmLinkProposal()}
            onLinkProposalDismiss={dismissLinkProposal}
            onInspectNode={(id) => {
              const n = board.nodes.find((x) => x.id === id);
              if (n?.type === "file") setInspectPath(n.file);
            }}
            onOpenFile={(rel) => void openExternalSmart(rel)}
            onRevealFile={(rel) => void window.box?.revealFile(rel)}
          />
          {inspectPath !== null && (
            <ImageInspector
              src={resolveMedia(inspectPath)}
              name={inspectPath}
              onClose={() => setInspectPath(null)}
            />
          )}
          {edgeNote && (
            <NotePanel
              note={edgeNote}
              edge={board.edges.find(
                (e) => e.id === edgeNote.frontmatter["box-edge"],
              )}
              stale={noteStale}
              onSave={(n) => void saveNote(n)}
              onUpdateEdge={(u) => void handleUpdateEdge(u)}
              onClose={() => setEdgeNote(null)}
              onDirtyChange={(d) => {
                noteDirty.current = d;
              }}
              onJumpNode={jumpToNode}
              onDelete={() => {
                const eid = edgeNote.frontmatter["box-edge"];
                if (typeof eid === "string") void deleteEdge(eid);
              }}
            />
          )}
          {filterOpen && (
            <CanvasFilter
              query={filterQuery}
              onQueryChange={setFilterQuery}
              selectedKind={filterKind}
              onSelectKind={setFilterKind}
              matchCount={matchedNodeIds.length}
              totalCount={board.nodes.length}
              activeIndex={filterMatchIdx}
              onNextMatch={nextFilterMatch}
              onPrevMatch={prevFilterMatch}
              onClose={() => setFilterOpen(false)}
            />
          )}
          {relatedDialog !== null && (
            <RelatedNotesDialog
              dialog={relatedDialog}
              onClose={() => setRelatedDialog(null)}
              onJump={jumpToNode}
              onLink={(targetId) => {
                void createEdge(
                  relatedDialog.sourceNode.id,
                  targetId,
                  "right",
                  "left",
                );
                setRelatedDialog(null);
              }}
            />
          )}
        </div>
      </div>
    ) : null;

  // Always the workbench: ribbon + sidebar + canvas. No workspace → the
  // sidebar holds the open-folder action and content is a bare canvas
  // surface - nothing but canvas on the inside, ever.
  return (
    <main className="workbench">
      <Ribbon
        hasWorkspace={workspaceRoot !== null}
        sidebarOpen={sidebarOpen}
        onOpenWorkspace={() => void open()}
        onRescan={() => void rescan()}
        onNewBoard={() => {
          setSidebarOpen(true);
          requestAnimationFrame(() => newBoardInput.current?.focus());
        }}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        boardOpen={board !== null}
        inkMode={inkMode}
        onInkMode={setInkMode}
        inkColor={inkColor}
        onInkColor={setInkColorPref}
        inkSize={inkSize}
        onInkSize={setInkSizePref}
        onZoomFit={() => setFitAll({ nonce: Date.now() })}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((v) => !v)}
        onExport={() => setExportOpen(true)}
        onHelp={() => setHelpOpen(true)}
        audioMode={audioMode}
        onAudioMode={setAudioModePref}
      />
      {sidebarOpen && (
        <aside className="sidebar">
          {workspaceRoot === null ? (
            <div className="sidebar-empty">
              <p>No workspace open.</p>
              <button onClick={() => void open()}>Open workspace folder</button>
            </div>
          ) : (
            <>
              <div className="sidebar-head" title={workspaceRoot}>
                <Icon name="folder" size={14} />
                <span>{baseName(workspaceRoot.replace(/[\\/]+$/, ""))}</span>
              </div>
              <div className="sidebar-newboard">
                <input
                  ref={newBoardInput}
                  placeholder="new board name"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void newBoard();
                  }}
                />
                <button onClick={() => void newBoard()} title="New board">
                  <Icon name="filePlus" size={14} />
                </button>
              </div>
              <BoxPanel
                files={files}
                placedPaths={placedPaths}
                boundInkPaths={boundInkPaths}
                pickedUp={pickUp}
                onPickUp={(p) => setPickUp((cur) => (cur === p ? null : p))}
                onPlace={(p) => void placeAtViewCenter(p)}
                onPlaceAll={(paths) => void placeAllGrid(paths)}
              />
              <FileTree
                files={files}
                activePath={boardPath ?? undefined}
                onOpen={(p) => void loadBoardFile(p)}
                onContextMenu={treeMenu}
              />
              {scaffoldOffered && (
                <div className="sidebar-scaffold">
                  <button onClick={() => void scaffold()}>
                    Scaffold workspace
                  </button>
                  <span className="sidebar-scaffold-hint">
                    atlas / calendar / cards / extras / sources / spaces
                  </span>
                </div>
              )}
            </>
          )}
        </aside>
      )}
      <div className="wb-content">
        {boardTabs.length > 0 && (
          <TabBar
            boards={boardTabs}
            activeBoardPath={boardPath}
            onSelectBoard={(p) => void loadBoardFile(p)}
            onCloseBoard={(p) => {
              if (p === boardPath) closeBoard();
            }}
            onNewBoard={() => {
              setSidebarOpen(true);
              requestAnimationFrame(() => newBoardInput.current?.focus());
            }}
          />
        )}
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
        {pickUp !== null && (
          <div
            className="pickup-overlay"
            title="Click to place - Esc cancels"
            onClick={(e) => {
              const vp = vpElRef.current;
              if (!vp || pickUp === null) return;
              const r = vp.getBoundingClientRect();
              const w = screenToWorld(
                camRef.current,
                e.clientX - r.left,
                e.clientY - r.top,
              );
              const p = pickUp;
              setPickUp(null);
              void placeFiles([p], w.x - 130, w.y - 90);
            }}
          >
            <span className="pickup-hint">
              placing {pickUp} - click to drop, Esc to cancel
            </span>
          </div>
        )}
        {problems.length > 0 && (
          <div className="problems">
            {problems.map((p, i) => (
              <div
                key={i}
                className="problem"
                title="Click to locate on the board"
                onClick={() => locateProblem(p)}
              >
                {p}
              </div>
            ))}
          </div>
        )}
        {boardPane ?? (
          <div className="empty-canvas">
            <span className="empty-canvas-hint">
              {workspaceRoot === null
                ? "open a workspace from the sidebar"
                : "select a board, or make one in the sidebar"}
            </span>
          </div>
        )}
        {workspaceRoot !== null && (
          <StatusBar
            zoomPct={zoomPct}
            nodeCount={board?.nodes.length ?? 0}
            edgeCount={board?.edges.length ?? 0}
            fileCount={files.length}
            problemCount={
              problems.length + boardProblems.length + brokenNodes.size
            }
            selectedCount={selectedNodeIds.length}
            onZoomIn={() => requestZoom("in")}
            onZoomOut={() => requestZoom("out")}
            onZoomReset={() => requestZoom("reset")}
            onZoomFit={() => setFitAll({ nonce: Date.now() })}
          />
        )}
        {quickOpen && board !== null && (
          <QuickOpen
            items={files.map((f) => ({ path: f.path, kind: fileKind(f.path) }))}
            onPick={(p) => void quickOpenPick(p)}
            onClose={() => setQuickOpen(false)}
          />
        )}
        <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
        {exportOpen && board !== null && (
          <ExportDialog
            board={board}
            boardPath={boardPath}
            selectedNodeIds={selectedNodeIds}
            format={exportFormat}
            onFormat={setExportFormat}
            scope={exportScope}
            onScope={setExportScope}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </main>
  );
}
