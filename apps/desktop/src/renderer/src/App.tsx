// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 1 shell: workspace file list + board canvas + link-note panel.
// The watcher pushes workspace:changed after every reconcile pass; we
// rescan the list and reload the open board only when it truly changed
// on disk (self-write echoes compare identical and are skipped).

import type {
    CanvasEdge,
    CanvasNode,
    Delta,
    InkStroke,
    LinkNote,
    ProblemItem,
    Side,
    WritePlan,
} from "@box/core";
import {
    baseName,
    BOARD_FORMAT,
    createEdgePlan,
    deleteEdgePlan,
    fileKind,
    hasScaffoldDirs,
    importSpecCanvas,
    isPathRel,
    linkNoteName,
    missingScaffoldFiles,
    newNodeId,
    oplogPath,
    parseBoard,
    parseInkSvg,
    parseLinkNote,
    parseOplogText,
    serializeBoard,
    serializeInkSvg,
    serializeLinkNote,
    serializeOplog
} from "@box/core";
import type {
    Camera,
    InkPoint,
    MenuItem,
    MenuSpec,
    WorkspaceFile,
} from "@box/ui";
import {
    BoardView,
    BoxPanel,
    ContextMenu,
    DEFAULT_CAMERA,
    FileTree,
    gridPlaceRect,
    Icon,
    ImageInspector,
    NotePanel,
    pathToPolygon,
    pointInPolygon,
    QuickOpen,
    Ribbon,
    screenToWorld,
    strokeToPath,
    translatePath,
    useBoxStore,
} from "@box/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { boxPlatform } from "./bridge.js";
import { loadSettings, makeSaver } from "./settings.js";
import {
    setSpatialAudioMode,
    spatialTick,
    type SpatialAudioMode,
} from "./spatialAudio.js";

interface WorkspaceChanged {
  files: WorkspaceFile[];
  deltas: Delta[];
  changedPaths: string[];
  problems: ProblemItem[];
  brokenNodes: string[];
  brokenEdges: string[];
}

declare global {
  interface Window {
    box?: {
      openWorkspace: () => Promise<{
        root: string;
        files: WorkspaceFile[];
      } | null>;
      rescan: (root: string) => Promise<WorkspaceFile[]>;
      lastWorkspace: () => Promise<string | null>;
      watchWorkspace: (
        root: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      onWorkspaceChanged: (cb: (e: WorkspaceChanged) => void) => () => void;
      readFile: (root: string, rel: string) => Promise<string | null>;
      writeFileAtomic: (
        root: string,
        rel: string,
        content: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      trashFile: (
        root: string,
        rel: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      appendTombstone: (
        root: string,
        edgeId: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      openExternal: (rel: string) => Promise<{ ok: boolean; error?: string }>;
      revealFile: (rel: string) => Promise<{ ok: boolean; error?: string }>;
      openWith: (
        rel: string,
        app: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      pickApp: () => Promise<string | null>;
      importFiles: (paths: string[]) => Promise<{
        ok: boolean;
        imported: { rel: string; src: string }[];
        skipped: { src: string; reason: string }[];
      }>;
      newFile: (
        dir: string,
        stem: string,
        ext: string,
        content: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      newBinaryFile: (
        dir: string,
        stem: string,
        ext: string,
        b64: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      copyFile: (
        rel: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      fileIcon: (
        rel: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      fileThumb: (
        rel: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>;
      pickFiles: (imagesOnly: boolean) => Promise<string[]>;
      onFileDrop: (
        cb: (paths: string[], x: number, y: number) => void,
      ) => Promise<() => void>;
    };
  }
}

/** True when the bytes look like text: no NULs, <5% control chars. */
function looksLikeText(s: string): boolean {
  if (s.includes("")) return false;
  const sample = s.slice(0, 4096);
  if (sample.length === 0) return false;
  let ctrl = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
  }
  return ctrl / sample.length < 0.05;
}

/** Execute a box-core WritePlan against the workspace, steps in order. */
async function applyPlan(root: string, plan: WritePlan): Promise<string[]> {
  const errors: string[] = [];
  const api = window.box;
  if (!api) return ["no bridge"];
  for (const step of plan.steps) {
    const r =
      step.op === "write-atomic"
        ? await api.writeFileAtomic(root, step.path, step.content)
        : step.op === "trash"
          ? await api.trashFile(root, step.path)
          : await api.appendTombstone(root, step.edgeId);
    if (!r.ok)
      errors.push(
        `${step.op} ${"path" in step ? step.path : step.edgeId}: ${r.error}`,
      );
  }
  return errors;
}

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
    setWorkspace,
    setFiles,
    openBoard,
    closeBoard,
    moveNode,
    addNode,
    removeNode,
    updateNode,
    addEdge,
    removeEdge,
    updateEdge,
    restoreBoard,
  } = useBoxStore();

  // ADR-0007: session undo - O(1) snapshots (persistent arrays) captured
  // once per user op. `gestureDirty` coalesces in-flight gestures: the
  // first mutation after a commit captures, the rest of the gesture
  // skips, and the next saveBoard re-arms. Edge ops stay excluded -
  // tombstone semantics are recoverable-by-design (I-2).
  const undoStack = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] }[]>([]);
  const redoStack = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] }[]>([]);
  const gestureDirty = useRef(false);
  const captureUndo = () => {
    if (gestureDirty.current) return;
    const b = useBoxStore.getState().board;
    if (b === null) return;
    gestureDirty.current = true;
    undoStack.current.push({ nodes: b.nodes, edges: b.edges });
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    scheduleOplogFlush();
  };

  // ADR-0007 v2: the stack also persists to `.box/oplog-<board>.json` -
  // debounced, atomic, and written through the same channel as boards.
  // Deltas are computed at flush time, so the hot path stays O(1).
  const oplogTimer = useRef<number | undefined>(undefined);
  const scheduleOplogFlush = () => {
    window.clearTimeout(oplogTimer.current);
    oplogTimer.current = window.setTimeout(() => {
      const root = useBoxStore.getState().workspaceRoot;
      const bp = useBoxStore.getState().boardPath;
      if (!root || !bp || !window.box) return;
      const s = serializeOplog(undoStack.current, bp);
      if (s) void window.box.writeFileAtomic(root, s.path, s.json);
    }, 800);
  };
  const seedOplog = async (root: string, boardRel: string) => {
    undoStack.current = [];
    redoStack.current = [];
    const text = await window.box?.readFile(root, oplogPath(boardRel));
    if (text === null || text === undefined) return;
    const stack = parseOplogText(text, boardRel);
    if (stack) undoStack.current = stack;
  };
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

  // Reconcile-authoritative broken sets (pushed by the watcher).
  const [remote, setRemote] = useState<{
    brokenNodes: Set<string>;
    brokenEdges: Set<string>;
  } | null>(null);
  // The selected edge's link note, parsed from disk.
  const [edgeNote, setEdgeNote] = useState<LinkNote | null>(null);
  const noteDirty = useRef(false);
  const [noteStale, setNoteStale] = useState(false);
  // First-run surface: board creation + doc excerpts + text editing.
  const [newBoardName, setNewBoardName] = useState("");
  const [fileTexts, setFileTexts] = useState<Map<string, string>>(new Map());
  const [editingNode, setEditingNode] = useState<string | null>(null);
  // Image inspector (PureRef/Eagle): the file path currently inspected.
  const [inspectPath, setInspectPath] = useState<string | null>(null);
  // Ink: "off" | "draw" | "erase" | "edit" board mode + parsed strokes.
  const [inkMode, setInkMode] = useState<"off" | "draw" | "erase" | "edit">(
    "off",
  );
  const [inkColor, setInkColor] = useState<string>("#e8b931");
  const [inkSize, setInkSize] = useState<number>(10);
  const [inkMap, setInkMap] = useState<Map<string, InkStroke[]>>(new Map());
  // Last node a stroke was written to - ink undo's target.
  const lastInkNode = useRef<string | null>(null);
  // FR-305: ext -> picked app path, persisted in .box/settings.json.
  const [openWithMap, setOpenWithMap] = useState<Record<string, string>>({});
  const [audioMode, setAudioMode] = useState<SpatialAudioMode>("off");
  const savePrefs = useRef<ReturnType<typeof makeSaver> | null>(null);
  // FR-202 pick-up mode: a Box row's file follows the cursor until the
  // user clicks the canvas to place it (or Esc cancels).
  const [pickUp, setPickUp] = useState<string | null>(null);
  // Shift+1 zoom-to-fit request.
  const [fitAll, setFitAll] = useState<{ nonce: number } | null>(null);
  // FR-104: text-kind file node being edited in place.
  const [fileEdit, setFileEdit] = useState<{
    nodeId: string;
    file: string;
    text: string;
  } | null>(null);
  // FR-205: camera-jump request (nonce re-fires when the same node is
  // jumped to twice in a row).
  const [focusNode, setFocusNode] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const newBoardInput = useRef<HTMLInputElement>(null);
  // Canvas context menu + the camera/viewport handles OS file drops need
  // to convert window coords into world space.
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const camRef = useRef<Camera>(DEFAULT_CAMERA);
  const vpElRef = useRef<HTMLDivElement | null>(null);

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

  const open = async () => {
    if (!window.box) {
      useBoxStore
        .getState()
        .setProblems(["bridge missing - preload did not load"]);
      return;
    }
    const r = await window.box.openWorkspace();
    if (r) {
      setWorkspace(r.root, r.files);
      const w = await window.box.watchWorkspace(r.root);
      await loadPrefs(r.root);
      await openFirstBoard(r.files, r.root);
      if (!w.ok)
        useBoxStore
          .getState()
          .setProblems([
            `watcher unavailable: ${w.error} - manual rescan only`,
          ]);
    }
  };

  const rescan = async () => {
    if (workspaceRoot && window.box) {
      setFiles(await window.box.rescan(workspaceRoot));
    }
  };

  const loadBoardFile = async (rel: string) => {
    // Read root from the store, not the closure: callers that just ran
    // setWorkspace (open, restore) still see the pre-set state value.
    const root = useBoxStore.getState().workspaceRoot;
    if (!root || !window.box) return false;
    const rawText = await window.box.readFile(root, rel);
    if (rawText === null) return false;
    let text: string = rawText;
    // ADR-0009: a foreign spec .canvas (no box-format marker) normalizes
    // IN PLACE - remapped ids, generated link notes, added box-format -
    // and keeps its name so spec readers (Obsidian) still open it.
    if (
      rel.endsWith(".canvas") &&
      !rel.endsWith(".box.canvas") &&
      !text.includes('"box-format"')
    ) {
      const imp = importSpecCanvas(text, rel);
      if ("error" in imp) {
        useBoxStore
          .getState()
          .setProblems([
            `malformed-board: ${rel} - not a canvas (${imp.error})`,
          ]);
        return false;
      }
      const w = await window.box.writeFileAtomic(root, rel, imp.boardJson);
      if (!w.ok) {
        useBoxStore
          .getState()
          .setProblems([`canvas import write failed: ${w.error}`]);
        return false;
      }
      for (const n of imp.notes) {
        const nw = await window.box.writeFileAtomic(root, n.path, n.content);
        if (!nw.ok) {
          useBoxStore
            .getState()
            .setProblems([`canvas import note failed at ${n.path}`]);
          return false;
        }
      }
      text = imp.boardJson;
    }
    const { value, problems } = parseBoard(text, rel);
    if (value) {
      openBoard(rel, value, problems);
      // ADR-0007 v2: seed restart-surviving undo from the board's log.
      void seedOplog(root, rel);
      return true;
    }
    useBoxStore.getState().setProblems(problems.map(fmtProblem));
    return false;
  };

  // "Notepad ready" (Obsidian): opening a workspace lands you on a board -
  // the first .box.canvas found, or a fresh .box/main.box.canvas if none.
  const openFirstBoard = async (files: WorkspaceFile[], root: string) => {
    const first = files
      .map((f) => f.path)
      .filter((p) => p.endsWith(".box.canvas"))
      .sort()[0];
    if (first !== undefined) {
      await loadBoardFile(first);
      return;
    }
    const rel = ".box/main.box.canvas";
    const r = await window.box?.writeFileAtomic(
      root,
      rel,
      serializeBoard({ nodes: [], edges: [], "box-format": BOARD_FORMAT }),
    );
    if (r?.ok === true) {
      useBoxStore
        .getState()
        .setFiles([...files, { path: rel, size: 0, mtime: Date.now() }]);
      await loadBoardFile(rel);
    }
  };

  // Scaffold offer (ACCESS/LYT): visible only when the workspace has no
  // ACCESS dirs at all, and only ever writes create-if-missing seeds.
  const scaffoldOffered =
    workspaceRoot !== null && !hasScaffoldDirs(files.map((f) => f.path));
  const scaffold = async () => {
    const root = useBoxStore.getState().workspaceRoot;
    if (!root || !window.box) return;
    const existing = new Set(useBoxStore.getState().files.map((f) => f.path));
    const missing = missingScaffoldFiles(existing);
    for (const f of missing) {
      const r = await window.box.writeFileAtomic(root, f.path, f.content);
      if (!r.ok) {
        useBoxStore
          .getState()
          .setProblems([`scaffold failed at ${f.path}: ${r.error}`]);
        return;
      }
    }
    await rescan();
  };

  // New board: write the empty canvas file, then open it.
  const newBoard = async () => {
    if (!workspaceRoot || !window.box) return;
    const slug = newBoardName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug === "") return;
    const rel = `.box/${slug}.box.canvas`;
    if (!isPathRel(rel)) {
      useBoxStore.getState().setProblems([`bad board name: ${newBoardName}`]);
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeBoard({ nodes: [], edges: [], "box-format": BOARD_FORMAT }),
    );
    if (r.ok) {
      setNewBoardName("");
      await loadBoardFile(rel);
    } else {
      useBoxStore.getState().setProblems([`board create failed: ${r.error}`]);
    }
  };

  // CDP verification handle (tools/cdp-eval.mjs drives real assertions).
  useEffect(() => {
    (window as unknown as { __boxStore: typeof useBoxStore }).__boxStore =
      useBoxStore;
  }, []);

  // Launch restore (Obsidian opens your last vault). Once per mount;
  // readLastWorkspace in main already stat-checks the dir still exists.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !window.box) return;
    restored.current = true;
    void (async () => {
      const last = await window.box!.lastWorkspace();
      if (!last) return;
      const files = await window.box!.rescan(last);
      await window.box!.watchWorkspace(last);
      useBoxStore.getState().setWorkspace(last, files);
      await loadPrefs(last);
      await openFirstBoard(files, last);
    })();
  }, []);

  // Text for the kinds that read it: excerpts for text nodes' file
  // bodies, rows for csv tables, JSON for board stats. Skip binaries
  // and anything over 1MB - a log dump is a tile, not a reader.
  const fileSizes = useMemo(
    () => new Map(files.map((f) => [f.path, f.size])),
    [files],
  );
  useEffect(() => {
    if (!workspaceRoot || !window.box || !board) return;
    const targets = board.nodes
      .filter(
        (n) =>
          n.type === "file" &&
          (fileSizes.get(n.file) ?? 0) <= 1024 * 1024 &&
          ["text", "csv", "board", "code", "palette"].includes(
            fileKind(n.file),
          ),
      )
      .map((n) => (n.type === "file" ? n.file : ""));
    if (targets.length === 0) return;
    void (async () => {
      const next = new Map(fileTexts);
      for (const p of targets) {
        if (next.has(p)) continue;
        const t = await window.box!.readFile(workspaceRoot, p);
        // board JSON needs the whole doc to parse; csv a few rows;
        // excerpts just enough to read.
        const cap =
          fileKind(p) === "board"
            ? 256 * 1024
            : fileKind(p) === "csv"
              ? 8 * 1024
              : 400;
        if (t !== null) next.set(p, t.slice(0, cap));
      }
      // Sniff pass: unknown extensions get a text excerpt when their
      // bytes are mostly printable - "every text file type" without
      // needing the extension in the table.
      for (const n of board.nodes) {
        if (n.type !== "file") continue;
        const p = n.file;
        if (
          fileKind(p) === "other" &&
          (fileSizes.get(p) ?? 0) <= 64 * 1024 &&
          !next.has(p)
        ) {
          const t = await window.box!.readFile(workspaceRoot, p);
          if (t !== null && looksLikeText(t)) next.set(p, t.slice(0, 400));
        }
      }
      setFileTexts(next);
    })();
    // fileTexts accumulated; targets derived from board nodes
  }, [board?.nodes, workspaceRoot]);

  // Ink sidecars: re-read every `box-ink` target so external edits to an
  // .ink.svg refresh the overlay (the watcher re-fires this via deps).
  const reloadInk = async () => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !window.box || !b) return;
    const next = new Map<string, InkStroke[]>();
    for (const n of b.nodes) {
      if (n.type !== "file") continue;
      const rel = n["box-ink"];
      if (typeof rel !== "string") continue;
      const t = await window.box.readFile(workspaceRoot, rel);
      if (t === null) continue;
      const { value, problems } = parseInkSvg(t, rel);
      if (problems.length > 0) {
        useBoxStore.getState().setProblems(problems.map(fmtProblem));
      }
      if (value) next.set(n.id, value.strokes);
    }
    setInkMap(next);
  };
  useEffect(() => {
    void reloadInk();
  }, [board?.nodes, workspaceRoot]);

  // FR-105: a finished stroke appends to the node's sidecar; the source
  // file itself is never touched.
  const inkStroke = async (nodeId: string, pts: InkPoint[]) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel =
      typeof n["box-ink"] === "string" ? n["box-ink"] : `${n.file}.ink.svg`;
    const d = strokeToPath(pts, inkSize);
    if (!d) return;
    const strokes = [
      ...(inkMap.get(nodeId) ?? []),
      { d, fill: inkColor, stroke: inkColor, "stroke-width": inkSize },
    ];
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes }),
    );
    if (!r.ok) {
      useBoxStore
        .getState()
        .setProblems([`ink save failed: ${r.error ?? rel}`]);
      return;
    }
    if (n["box-ink"] !== rel) updateNodeC(nodeId, { "box-ink": rel });
    setInkMap(new Map(inkMap).set(nodeId, strokes));
    lastInkNode.current = nodeId;
    await saveBoard();
  };

  // FR-305/307: .box/settings.json is non-truth prefs - load on workspace
  // open, debounce-save on change. Missing/corrupt file degrades to
  // defaults silently (settings.ts contract).
  const loadPrefs = async (root: string) => {
    savePrefs.current = makeSaver(root);
    const s = await loadSettings(root);
    if (typeof s.ink?.color === "string") setInkColor(s.ink.color);
    if (typeof s.ink?.size === "number") setInkSize(s.ink.size);
    if (s.audio?.mode === "all" || s.audio?.mode === "viewport")
      setAudioMode(s.audio.mode);
    setOpenWithMap(s.openWith ?? {});
  };

  const setInkColorPref = (c: string) => {
    setInkColor(c);
    savePrefs.current?.({ ink: { color: c, size: inkSize } });
  };
  const setInkSizePref = (s: number) => {
    setInkSize(s);
    savePrefs.current?.({ ink: { color: inkColor, size: s } });
  };

  // FR-306: cycle off -> all -> viewport; the mode persists as a non-truth
  // pref and drives the WebAudio pan/gain graph for playing audio nodes.
  const setAudioModePref = (m: SpatialAudioMode) => {
    setSpatialAudioMode(m); // inside the click gesture: AudioContext allowed
    setAudioMode(m);
    savePrefs.current?.({ audio: { mode: m } });
  };

  // While spatial audio is on, recompute pan/gain every frame from the live
  // camera; on switch-off (or board close) run one passthrough tick so
  // already-wired elements return to neutral.
  useEffect(() => {
    let raf = 0;
    const nodes = () => new Map((board?.nodes ?? []).map((n) => [n.id, n]));
    const tick = () => {
      const vp = vpElRef.current;
      if (vp !== null) {
        const r = vp.getBoundingClientRect();
        spatialTick(camRef.current, r.width, r.height, nodes());
      }
      if (audioMode !== "off") raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [audioMode, board]);

  // FR-305: preferred app per extension wins over the OS default.
  const openExternalSmart = async (rel: string) => {
    if (!window.box) return;
    const ext = `.${(rel.split(".").pop() ?? "").toLowerCase()}`;
    const app = openWithMap[ext];
    if (app !== undefined) {
      const r = await window.box.openWith(rel, app);
      if (r.ok) return;
      // Recorded app vanished/failed - drop the pref, fall to default.
      const next = { ...openWithMap };
      delete next[ext];
      setOpenWithMap(next);
      savePrefs.current?.({ openWith: next });
    }
    const r = await window.box.openExternal(rel);
    if (!r.ok)
      useBoxStore.getState().setProblems([`open failed: ${rel} - ${r.error}`]);
  };

  // Ink edit mode (FR-307 partial): drag translates a stroke's polygon.
  // Foreign (non-polygon) paths refuse the move rather than corrupting.
  const inkStrokeMove = async (
    nodeId: string,
    idx: number,
    dx: number,
    dy: number,
  ) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || idx < 0 || idx >= strokes.length)
      return;
    const nd = translatePath(strokes[idx]!.d, dx, dy);
    if (nd === null) return;
    const next = strokes.map((s, i) => (i === idx ? { ...s, d: nd } : s));
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: next }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, next));
  };

  // Ink undo: pop the last stroke off a node's sidecar; empty sidecar is
  // trashed recoverably, same as the erase-all path.
  const inkUndo = async (nodeId: string) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || strokes.length === 0) return;
    const kept = strokes.slice(0, -1);
    if (kept.length === 0) {
      await window.box.trashFile(workspaceRoot, rel);
      updateNodeC(nodeId, { "box-ink": undefined });
      const m = new Map(inkMap);
      m.delete(nodeId);
      setInkMap(m);
      await saveBoard();
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: kept }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, kept));
  };

  // FR-106: erase removes whole strokes hit by the pointer (a small ring
  // of sample points makes the target forgiving). Empty sidecars are
  // trashed, not left as zero-byte litter.
  const inkErase = async (nodeId: string, lx: number, ly: number) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || strokes.length === 0) return;
    const samples: Array<[number, number]> = [
      [lx, ly],
      [lx + 5, ly],
      [lx - 5, ly],
      [lx, ly + 5],
      [lx, ly - 5],
    ];
    const hit = (d: string) => {
      const poly = pathToPolygon(d);
      if (poly) return samples.some(([x, y]) => pointInPolygon(x, y, poly));
      // Non-polygon `d` (hand-written or older sidecars): DOM hit-test
      // in the path's own user units, same space lx/ly are in.
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", d);
      const pt = new DOMPoint(0, 0);
      return samples.some(([x, y]) => {
        pt.x = x;
        pt.y = y;
        return el.isPointInFill(pt);
      });
    };
    const kept = strokes.filter((s) => !hit(s.d));
    if (kept.length === strokes.length) return;
    if (kept.length === 0) {
      await window.box.trashFile(workspaceRoot, rel);
      updateNodeC(nodeId, { "box-ink": undefined });
      const m = new Map(inkMap);
      m.delete(nodeId);
      setInkMap(m);
      await saveBoard();
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: kept }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, kept));
  };

  // FR-104: in-place editing for text-kind file nodes - read the file,
  // edit, write back atomically. Round-trips through the same path the
  // excerpt loader uses so the preview refreshes.
  const startFileEdit = async (node: CanvasNode) => {
    if (!workspaceRoot || !window.box || node.type !== "file") return;
    const t = await window.box.readFile(workspaceRoot, node.file);
    if (t === null) {
      useBoxStore.getState().setProblems([`cannot read ${node.file}`]);
      return;
    }
    setFileEdit({ nodeId: node.id, file: node.file, text: t });
  };
  const commitFileEdit = async (nodeId: string, text: string) => {
    const fe = fileEdit;
    setFileEdit(null);
    if (!fe || fe.nodeId !== nodeId || !workspaceRoot || !window.box) return;
    if (text === fe.text) return;
    const r = await window.box.writeFileAtomic(workspaceRoot, fe.file, text);
    if (!r.ok) {
      useBoxStore.getState().setProblems([`save failed: ${fe.file}`]);
      return;
    }
    setFileTexts(new Map(fileTexts).set(fe.file, text.slice(0, 400)));
  };

  // FR-205: NotePanel from/to jump -> board camera centers the endpoint.
  const jumpToNode = (id: string) => setFocusNode({ id, nonce: Date.now() });

  // Problem rows are `kind: path - detail`. Clicking locates the object:
  // first look for any board node whose file/sidecar/id appears anywhere in
  // the message (detail text carries the interesting path, e.g. "file
  // missing: x.txt"); fall back to the headline path. A board path opens
  // that board. Non-path problems no-op.
  const locateProblem = (p: string) => {
    const b = useBoxStore.getState().board;
    if (b) {
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

  // Global keys: Shift+1 zoom-to-fit (Obsidian), Esc cancels pick-up,
  // Ctrl/Cmd+Z pops the last ink stroke while an ink mode is active.
  // Text inputs are never hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t.closest?.("[contenteditable='true']") ?? null) !== null)
      )
        return;
      if (e.key === "Escape" && pickUp !== null) {
        setPickUp(null);
        return;
      }
      if (e.key === "!" && e.shiftKey && board !== null) {
        setFitAll({ nonce: Date.now() });
        return;
      }
      if (
        (e.key === "p" || e.key === "P") &&
        (e.ctrlKey || e.metaKey) &&
        board !== null
      ) {
        e.preventDefault();
        setQuickOpen((v) => !v);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (board === null) return;
        e.preventDefault();
        // Ink mode keeps its own stroke-level undo; the board stack
        // owns everything else (ADR-0007).
        if (e.shiftKey) void redo();
        else if (inkMode !== "off" && lastInkNode.current !== null)
          void inkUndo(lastInkNode.current);
        else void undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (board === null) return;
        e.preventDefault();
        void redo();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickUp, board, inkMode, inkMap, workspaceRoot]);

  // FR-202: place a Box file at the current viewport center (the "+"
  // affordance) or at a dropped world point (pick-up click).
  const placeAtViewCenter = async (path: string) => {
    const vp = vpElRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const w = screenToWorld(camRef.current, r.width / 2, r.height / 2);
    await placeFiles([path], w.x - 130, w.y - 90);
  };
  // Quick-open pick: already on the board -> jump to it (Obsidian
  // switcher semantics); unplaced -> drop at viewport center.
  const quickOpenPick = async (path: string) => {
    const hit = board?.nodes.find((n) => n.type === "file" && n.file === path);
    if (hit) {
      setFocusNode({ id: hit.id, nonce: Date.now() });
      return;
    }
    await placeAtViewCenter(path);
  };
  const placeAllGrid = async (paths: string[]) => {
    const nodes = useBoxStore.getState().board?.nodes ?? [];
    const next = [...nodes];
    for (let i = 0; i < paths.length; i++) {
      const g = gridPlaceRect(next, i);
      const node: CanvasNode = {
        id: newNodeId(),
        type: "file",
        x: g.x,
        y: g.y,
        width: 260,
        height: 180,
        file: paths[i]!,
      };
      addNodeC(node);
      next.push(node);
    }
    await saveBoard();
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

  // ADR-0007 v1: restore a captured snapshot through the normal board
  // write path - undo never invents a second persistence channel. Edges
  // whose endpoints differ between snapshots have their link notes
  // rewritten too (R-B: the note is endpoint-authoritative, so a
  // board-only restore would be reverted by the next reconcile).
  const healChangedEdgeNotes = async (
    before: CanvasEdge[],
    after: CanvasEdge[],
    restored: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  ) => {
    const preMap = new Map(before.map((e) => [e.id, e]));
    for (const e of after) {
      const pre = preMap.get(e.id);
      if (
        pre !== undefined &&
        (pre.fromNode !== e.fromNode || pre.toNode !== e.toNode)
      )
        await syncEdgeNote(e.id, restored);
    }
  };
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
  // it. Board reload compares serialized content so self-write echoes are
  // skipped and a mid-drag board is never yanked by our own save.
  useEffect(() => {
    const api = window.box;
    if (!api) return;
    return api.onWorkspaceChanged((e) => {
      const s = useBoxStore.getState();
      setFiles(e.files);
      s.setProblems(e.problems.map(fmtProblem));
      setRemote({
        brokenNodes: new Set(e.brokenNodes),
        brokenEdges: new Set(e.brokenEdges),
      });
      for (const d of e.deltas) {
        if (d.kind === "renamed" && d.to !== undefined) {
          const to = d.to;
          setInspectPath((cur) => (cur === d.path ? to : cur));
          setFileTexts((prev) => {
            const ex = prev.get(d.path) ?? fileTexts.get(d.path);
            if (ex === undefined) return prev;
            const next = new Map(prev);
            next.set(to, ex);
            return next;
          });
        }
      }
      const { boardPath: bp, board: cur, workspaceRoot: root } = s;
      if (root && bp && e.changedPaths.includes(bp)) {
        void (async () => {
          const text = await api.readFile(root, bp);
          if (text === null) {
            s.setProblems([`board deleted on disk: ${bp}`]);
            return;
          }
          const { value, problems } = parseBoard(text, bp);
          if (value && serializeBoard(value) !== serializeBoard(cur!)) {
            openBoard(bp, value, problems);
          }
        })();
      }
      // External edit to an ink sidecar: refresh the overlays.
      if (root && e.changedPaths.some((p) => p.endsWith(".ink.svg"))) {
        void reloadInk();
      }
      // External edit to the open note: reload unless the user is editing.
      const openPath = edgeNote?.path;
      if (
        root &&
        openPath &&
        e.changedPaths.includes(openPath) &&
        !noteDirty.current
      ) {
        void api.readFile(root, openPath).then((text) => {
          if (text === null) return;
          const { value } = parseLinkNote(text, openPath);
          if (value) setEdgeNote(value);
        });
      } else if (root && openPath && e.changedPaths.includes(openPath)) {
        setNoteStale(true);
      }
    });
  }, [edgeNote?.path]);

  // I-1: edge draw -> link note written first, board second.
  const createEdge = async (
    fromId: string,
    toId: string,
    fromSide: Side,
    toSide: Side,
  ) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const { plan, edge } = createEdgePlan(b, boardPath, fromId, toId, {
      fromSide,
      toSide,
    });
    const errors = await applyPlan(workspaceRoot, plan);
    if (errors.length === 0) {
      addEdge(edge);
      void rescan(); // the new link-<id>.md should appear in the file list
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // I-2: edge erase -> tombstone, board, note to Recycle Bin.
  const deleteEdge = async (edgeId: string) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const errors = await applyPlan(
      workspaceRoot,
      deleteEdgePlan(b, boardPath, edgeId),
    );
    if (errors.length === 0) {
      removeEdge(edgeId);
      setEdgeNote(null);
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Edge selected -> load its link note (the meaning half of the wedge).
  const selectEdge = async (edgeId: string | null) => {
    if (edgeId === null || !workspaceRoot || !window.box) {
      setEdgeNote(null);
      noteDirty.current = false;
      setNoteStale(false);
      return;
    }
    const edge = board?.edges.find((e) => e.id === edgeId);
    const rel =
      (edge?.["box-link"] as string | undefined) ?? linkNoteName(edgeId);
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) {
      setEdgeNote(null);
      useBoxStore.getState().setProblems([`link note missing on disk: ${rel}`]);
      return;
    }
    const { value, problems } = parseLinkNote(text, rel);
    if (value) {
      setEdgeNote(value);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      setEdgeNote(null);
      useBoxStore.getState().setProblems(problems.map(fmtProblem));
    }
  };

  // Re-route: an edge endpoint dropped on a new node keeps the edge id and
  // the link note - only from/to + the *-file denorms change (the note IS
  // the relationship, so retargeting edits it in place, not delete+create).
  // Rewrite a link note's endpoint denorms to match the board edge. The
  // note is endpoint-authoritative on reconcile (R-B: note wins), so any
  // board-side endpoint change must write the note too or the next sync
  // silently reverts it.
  const syncEdgeNote = async (
    edgeId: string,
    b: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  ) => {
    const e = b.edges.find((x) => x.id === edgeId);
    if (e === undefined || workspaceRoot === null || !window.box) return;
    const rel = e["box-link"];
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) return;
    const { value } = parseLinkNote(text, rel);
    if (!value) return;
    const fm = { ...value.frontmatter };
    fm.from = e.fromNode;
    fm.to = e.toNode;
    const fileOf = (id: string) => {
      const n = b.nodes.find((x) => x.id === id);
      return n?.type === "file" ? n.file : undefined;
    };
    const ff = fileOf(e.fromNode);
    const tf = fileOf(e.toNode);
    if (ff !== undefined) fm["from-file"] = ff;
    else delete fm["from-file"];
    if (tf !== undefined) fm["to-file"] = tf;
    else delete fm["to-file"];
    await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeLinkNote({ ...value, frontmatter: fm }),
    );
  };

  const retargetEdge = async (
    edgeId: string,
    end: "from" | "to",
    nodeId: string,
    side: Side,
  ) => {
    const b = useBoxStore.getState().board;
    const e = b?.edges.find((x) => x.id === edgeId);
    const n = b?.nodes.find((x) => x.id === nodeId);
    if (!b || !e || !n || !workspaceRoot || !window.box) return;
    captureUndo();
    updateEdge(
      edgeId,
      end === "to"
        ? { toNode: nodeId, toSide: side }
        : { fromNode: nodeId, fromSide: side },
    );
    const after = useBoxStore.getState().board;
    if (after !== null) await syncEdgeNote(edgeId, after);
    await saveBoard();
    // If the open note panel shows this edge, refresh it.
    if (edgeNote?.path === e["box-link"]) void selectEdge(edgeId);
  };

  const saveNote = async (next: LinkNote) => {
    if (!workspaceRoot || !window.box) return;
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      next.path,
      serializeLinkNote(next),
    );
    if (r.ok) {
      setEdgeNote(next);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      useBoxStore.getState().setProblems([`note save failed: ${r.error}`]);
    }
  };

  // Node creation: double-click empty canvas or drop a file from the list.
  const createTextNode = async (wx: number, wy: number) => {
    const node: CanvasNode = {
      id: newNodeId(),
      type: "text",
      x: Math.round(wx),
      y: Math.round(wy),
      width: 220,
      height: 90,
      text: "",
    };
    addNodeC(node);
    setEditingNode(node.id);
    await saveBoard();
  };

  const placeFile = async (path: string, wx: number, wy: number) => {
    await placeFiles([path], wx, wy);
  };

  // N files cascade-diagonal from the drop point; one board write total.
  const placeFiles = async (paths: string[], wx: number, wy: number) => {
    for (let i = 0; i < paths.length; i++) {
      const node: CanvasNode = {
        id: newNodeId(),
        type: "file",
        x: Math.round(wx) + i * 40,
        y: Math.round(wy) + i * 40,
        width: 260,
        height: 180,
        file: paths[i]!,
      };
      addNodeC(node);
    }
    await saveBoard();
  };

  // External files are COPIED into the workspace (files-are-truth: nodes
  // only ever reference workspace-rel paths). Skipped entries are surfaced,
  // never silent.
  const importAndPlace = async (srcPaths: string[], wx: number, wy: number) => {
    if (!window.box || srcPaths.length === 0) return;
    const r = await window.box.importFiles(srcPaths);
    const s = useBoxStore.getState();
    if (!r.ok || r.skipped.length > 0) {
      s.setProblems(r.skipped.map((x) => `skipped ${x.src}: ${x.reason}`));
    }
    if (r.imported.length > 0) {
      await placeFiles(
        r.imported.map((x) => x.rel),
        wx,
        wy,
      );
      await rescan();
    }
  };

  // Clipboard → canvas: image items become real .png files (pasted bytes
  // are user content, so they land as files like everything else); text
  // becomes a text node already carrying the content.
  const pasteAt = async (wx: number, wy: number) => {
    if (!navigator.clipboard?.read) {
      useBoxStore.getState().setProblems(["clipboard read unsupported"]);
      return;
    }
    let items: ClipboardItem[];
    try {
      items = await navigator.clipboard.read();
    } catch (e) {
      useBoxStore.getState().setProblems([`clipboard read denied: ${e}`]);
      return;
    }
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith("image/"));
      if (imgType) {
        const blob = await item.getType(imgType);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000)
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const r = await window.box!.newBinaryFile(
          "",
          "paste",
          "png",
          btoa(bin),
        );
        if (r.ok && r.path) await placeFile(r.path, wx, wy);
        else
          useBoxStore
            .getState()
            .setProblems([`paste failed: ${r.error ?? "unknown"}`]);
        return;
      }
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        const node: CanvasNode = {
          id: newNodeId(),
          type: "text",
          x: Math.round(wx),
          y: Math.round(wy),
          width: 260,
          height: 120,
          text: text.slice(0, 4000),
        };
        addNodeC(node);
        await saveBoard();
        return;
      }
    }
    useBoxStore.getState().setProblems(["clipboard: nothing placeable"]);
  };

  // ---- right-click menus ----

  const canvasMenu = (wx: number, wy: number, cx: number, cy: number) => {
    const items: MenuItem[] = [
      {
        label: "New text note",
        icon: "type",
        hint: "dbl-click",
        onPick: () => void createTextNode(wx, wy),
      },
      {
        label: "New document",
        icon: "fileText",
        onPick: () =>
          void (async () => {
            const r = await window.box!.newFile("", "untitled", "md", "");
            if (r.ok && r.path) await placeFile(r.path, wx, wy);
            else if (!r.ok)
              useBoxStore
                .getState()
                .setProblems([`new document failed: ${r.error}`]);
            await rescan();
          })(),
      },
      {
        label: "New board",
        icon: "board",
        onPick: () =>
          void (async () => {
            const r = await window.box!.newFile(
              ".box",
              "board",
              "box.canvas",
              serializeBoard({
                nodes: [],
                edges: [],
                "box-format": BOARD_FORMAT,
              }),
            );
            if (r.ok && r.path) {
              await rescan();
              await loadBoardFile(r.path);
            } else if (!r.ok) {
              useBoxStore
                .getState()
                .setProblems([`new board failed: ${r.error}`]);
            }
          })(),
      },
      {
        label: "Import files…",
        icon: "import",
        onPick: () =>
          void window
            .box!.pickFiles(false)
            .then((p) => importAndPlace(p, wx, wy)),
      },
      {
        label: "Import image…",
        icon: "image",
        onPick: () =>
          void window
            .box!.pickFiles(true)
            .then((p) => importAndPlace(p, wx, wy)),
      },
      {
        label: "Paste",
        icon: "clipboard",
        hint: "ctrl+v",
        disabled: !("clipboard" in navigator && "read" in navigator.clipboard),
        onPick: () => void pasteAt(wx, wy),
      },
    ];
    setMenu({ x: cx, y: cy, items });
  };

  const nodeMenu = (node: CanvasNode, cx: number, cy: number) => {
    const items: MenuItem[] = [];
    if (node.type === "file") {
      const file = node.file;
      const ext = `.${(file.split(".").pop() ?? "").toLowerCase()}`;
      items.push(
        {
          label: "Open externally",
          icon: "external",
          hint: "dbl-click",
          onPick: () => void openExternalSmart(file),
        },
        {
          label: "Open with…",
          icon: "external",
          onPick: () =>
            void (async () => {
              const app = await window.box?.pickApp();
              if (!app) return;
              const r = await window.box!.openWith(file, app);
              if (r.ok) {
                const next = { ...openWithMap, [ext]: app };
                setOpenWithMap(next);
                savePrefs.current?.({ openWith: next });
              } else {
                useBoxStore
                  .getState()
                  .setProblems([`open-with failed: ${r.error}`]);
              }
            })(),
        },
      );
      if (openWithMap[ext] !== undefined) {
        items.push({
          label: `Reset default app for ${ext}`,
          icon: "refresh",
          onPick: () => {
            const next = { ...openWithMap };
            delete next[ext];
            setOpenWithMap(next);
            savePrefs.current?.({ openWith: next });
          },
        });
      }
      items.push({
        label: "Reveal in Explorer",
        icon: "folderOpen",
        hint: "alt+dbl",
        onPick: () => void window.box?.revealFile(file),
      });
      // JSON Canvas `color` is spec-native ("1"-"6" presets + hex) - a
      // chained menu keeps the flat ContextMenu component untouched.
      items.push({
        label: "Set color…",
        icon: "pen",
        onPick: () => {
          const swatch = (v: string | null, label: string): MenuItem => ({
            label,
            onPick: () => {
              updateNodeC(node.id, { color: v ?? undefined });
              void saveBoard();
            },
          });
          const items2: MenuItem[] = [
            swatch(null, "Default"),
            swatch("1", "Red"),
            swatch("2", "Orange"),
            swatch("3", "Yellow"),
            swatch("4", "Green"),
            swatch("5", "Cyan"),
            swatch("6", "Purple"),
          ];
          setMenu({ x: cx, y: cy, items: items2 });
        },
      });
      if (fileKind(file) === "image") {
        items.push({
          label: "Inspect",
          icon: "image",
          onPick: () => setInspectPath(file),
        });
      }
      if (fileKind(file) === "text" || fileKind(file) === "code") {
        items.push({
          label: "Edit in place",
          icon: "type",
          hint: "dbl-click",
          onPick: () => void startFileEdit(node),
        });
      }
      if (typeof node["box-ink"] === "string") {
        items.push({
          label: "Clear ink strokes",
          icon: "eraser",
          onPick: () =>
            void (async () => {
              const rel = node["box-ink"];
              if (typeof rel !== "string" || !workspaceRoot) return;
              await window.box!.trashFile(workspaceRoot, rel);
              updateNode(node.id, { "box-ink": undefined });
              const m = new Map(inkMap);
              m.delete(node.id);
              setInkMap(m);
              await saveBoard();
            })(),
        });
      }
      items.push(
        {
          label: "Remove from canvas",
          icon: "file",
          onPick: () => void deleteNode(node.id),
        },
        {
          label: "Move file to Recycle Bin",
          icon: "trash",
          danger: true,
          onPick: () =>
            void (async () => {
              const r = await window.box!.trashFile(
                useBoxStore.getState().workspaceRoot!,
                file,
              );
              if (r.ok) {
                // The node would render broken (I-7); an intentional delete
                // removes the placement too - the watcher reconciles edges.
                removeNodeC(node.id);
                await saveBoard();
                await rescan();
              } else {
                useBoxStore
                  .getState()
                  .setProblems([`trash failed: ${r.error}`]);
              }
            })(),
        },
      );
    } else {
      if (node.type === "group") {
        // ADR-0008 regions: a group carrying `box-region` is a named zone
        // with parameters. label=region name, locked=children ignore drags.
        const region = node["box-region"] as
          { v?: number; locked?: boolean } | undefined;
        if (region === undefined) {
          items.push({
            label: "Make region",
            icon: "box",
            onPick: () => {
              updateNodeC(node.id, { "box-region": { v: 1, locked: false } });
              void saveBoard();
            },
          });
        } else {
          items.push(
            {
              label:
                region.locked === true ? "Unlock children" : "Lock children",
              icon: "move",
              onPick: () => {
                updateNodeC(node.id, {
                  "box-region": { ...region, locked: region.locked !== true },
                });
                void saveBoard();
              },
            },
            {
              label: "Remove region",
              icon: "file",
              onPick: () => {
                updateNodeC(node.id, { "box-region": undefined });
                void saveBoard();
              },
            },
          );
        }
      }
      items.push({
        label: "Remove from canvas",
        icon: "file",
        onPick: () => void deleteNode(node.id),
      });
    }
    setMenu({ x: cx, y: cy, items });
  };

  // OS drag-drop: Tauri intercepts file drops (HTML5 never sees them) and
  // reports physical-pixel positions - convert through dpr + the live
  // camera into world coords, import the files, place the nodes.
  useEffect(() => {
    const api = window.box;
    if (!workspaceRoot || !api?.onFileDrop) return;
    let un: (() => void) | null = null;
    void api
      .onFileDrop((paths, x, y) => {
        const el = vpElRef.current;
        if (!el || paths.length === 0) return;
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = screenToWorld(
          camRef.current,
          x / dpr - r.left,
          y / dpr - r.top,
        );
        void importAndPlace(paths, w.x, w.y);
      })
      .then((u) => {
        un = u;
      });
    return () => un?.();
    // importAndPlace reads fresh state internally; workspace gate only
  }, [workspaceRoot]);

  // Arrow released over empty canvas: create the target text node and the
  // edge in one plan (note write, then board write - I-1 ordering holds).
  const dropEdgeAt = async (
    fromId: string,
    fromSide: Side,
    wx: number,
    wy: number,
  ) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const node: CanvasNode = {
      id: newNodeId(),
      type: "text",
      x: Math.round(wx) - 110,
      y: Math.round(wy) - 45,
      width: 220,
      height: 90,
      text: "",
    };
    const grown: typeof b = { ...b, nodes: [...b.nodes, node] };
    const { plan, edge } = createEdgePlan(grown, boardPath, fromId, node.id, {
      fromSide,
      toSide: "left",
    });
    const errors = await applyPlan(workspaceRoot, plan);
    if (errors.length === 0) {
      addNodeC(node);
      addEdge(edge);
      setEditingNode(node.id);
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Delete key on a selected node: remove the placement, keep the file.
  const deleteNode = async (id: string) => {
    removeNodeC(id);
    await saveBoard();
  };

  // Multi-delete: one capture + one board write for the whole set.
  const deleteNodes = async (ids: string[]) => {
    for (const id of ids) removeNodeC(id);
    await saveBoard();
  };

  // JSON Canvas groups: spatial membership (node center inside bounds),
  // so creating a group is just placing a bigger rect around the set.
  const groupSelection = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b) return;
    const ns = b.nodes.filter((n) => ids.includes(n.id));
    if (ns.length === 0) return;
    const PAD = 48;
    const x0 = Math.min(...ns.map((n) => n.x)) - PAD;
    const y0 = Math.min(...ns.map((n) => n.y)) - PAD;
    const x1 = Math.max(...ns.map((n) => n.x + n.width)) + PAD;
    const y1 = Math.max(...ns.map((n) => n.y + n.height)) + PAD;
    addNodeC({
      id: newNodeId(),
      type: "group",
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
      label: "Group",
    });
    await saveBoard();
  };

  // Ungroup removes the group rect only - members are never touched.
  const ungroupSelection = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b) return;
    const groups = ids.filter((id) =>
      b.nodes.some((n) => n.id === id && n.type === "group"),
    );
    for (const id of groups) removeNodeC(id);
    if (groups.length > 0) await saveBoard();
  };

  // Ctrl+D duplicate: text/link/group nodes clone their record; file
  // nodes copy the file on disk first (files-are-truth - two nodes may
  // not share one object identity).
  const duplicateNodes = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b || !window.box) return;
    for (const id of ids) {
      const n = b.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (n.type === "file") {
        const r = await window.box.copyFile(n.file);
        if (!r.ok || !r.path) {
          useBoxStore
            .getState()
            .setProblems([`duplicate failed: ${r.error ?? "unknown"}`]);
          continue;
        }
        addNodeC({
          ...n,
          id: newNodeId(),
          x: n.x + 32,
          y: n.y + 32,
          file: r.path,
        });
        continue;
      }
      addNodeC({ ...n, id: newNodeId(), x: n.x + 32, y: n.y + 32 });
    }
    await saveBoard();
    await rescan();
  };

  // Ctrl+V: paste at the viewport center (same content paths as the
  // context-menu paste, just keyboard-driven).
  const pasteAtCenter = async () => {
    const vp = vpElRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const w = screenToWorld(camRef.current, r.width / 2, r.height / 2);
    await pasteAt(w.x, w.y);
  };

  const commitText = async (id: string, text: string) => {
    updateNodeC(id, { text });
    setEditingNode(null);
    await saveBoard();
  };

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
            onDropFile={(p, x, y) => void placeFile(p, x, y)}
            onEmptyDoubleClick={(x, y) => void createTextNode(x, y)}
            onCanvasMenu={canvasMenu}
            onNodeMenu={nodeMenu}
            onCameraChange={(c) => {
              camRef.current = c;
            }}
            viewportRef={vpElRef}
            onDropEdgeAt={(f, s, x, y) => void dropEdgeAt(f, s, x, y)}
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
              stale={noteStale}
              onSave={(n) => void saveNote(n)}
              onClose={() => setEdgeNote(null)}
              onDirtyChange={(d) => {
                noteDirty.current = d;
              }}
              onJumpNode={jumpToNode}
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
        {quickOpen && board !== null && (
          <QuickOpen
            items={files.map((f) => ({ path: f.path, kind: fileKind(f.path) }))}
            onPick={(p) => void quickOpenPick(p)}
            onClose={() => setQuickOpen(false)}
          />
        )}
      </div>
    </main>
  );
}
