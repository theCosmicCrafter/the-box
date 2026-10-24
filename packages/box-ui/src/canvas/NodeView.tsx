// SPDX-License-Identifier: LicenseRef-Proprietary
// NodeView - per-kind DOM renderer + drag/select + edge-draft handles.
// File nodes render real content: images via a resolveMedia callback
// (desktop wires it to the box:// protocol), text/markdown via excerpt.
// Text nodes edit in place on double-click. Selected nodes get a resize
// handle (bottom-right). Broken file nodes keep geometry and render
// visibly broken (I-7). Side handles appear on hover/selected (tldraw
// pattern): drag from one to start a connection draft.

import type { CanvasNode, FileKind, InkStroke, Side } from "@box/core";
import { baseName, fileKind, inkStrokeColor } from "@box/core";
import { memo, useEffect, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { DEFAULT_CAMERA, screenToWorld } from "./camera.js";
import { pickStroke } from "./ink.js";
import {
    CodeView,
    DecodedImage,
    HtmlPreview,
    LutPreview,
    ModelPreview,
    needsImageDecode,
    PalettePreview,
    RawImage,
    TexturePreview,
    VideoPreview,
    WaveformPreview,
    ZipPreview,
} from "./previews.js";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
// Handles sit fully inside the node edge: .node is overflow:hidden, so a
// border-straddling handle would clip its outer half and leave a ~5px hit
// sliver. Inset dots stay whole and grabbable.
const HANDLE_POS: Record<Side, React.CSSProperties> = {
  top: { left: "50%", top: "3px", marginLeft: "-8px" },
  right: { left: "calc(100% - 19px)", top: "50%", marginTop: "-8px" },
  bottom: { left: "50%", top: "calc(100% - 19px)", marginLeft: "-8px" },
  left: { left: "3px", top: "50%", marginTop: "-8px" },
};

const MIN_NODE = 40;

/** JSON Canvas preset palette (Obsidian-readable "1"-"6") mapped to muted
 * dark-theme tints; hex strings pass through unchanged. */
export const NODE_COLOR_PRESETS: Record<string, string> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#e8b931",
  "4": "#30a46c",
  "5": "#12a594",
  "6": "#8e4ec6",
};

export function nodeTint(color: string | undefined): string | null {
  if (color === undefined || color === "") return null;
  return NODE_COLOR_PRESETS[color] ?? color;
}

export interface NodeViewProps {
  node: CanvasNode;
  /** Live camera (ref, not a prop value): pan/zoom would otherwise re-render
   * every node each frame; handlers read `.current` at event time. */
  cameraRef: React.RefObject<Camera>;
  selected: boolean;
  broken: boolean;
  dropTarget?: boolean;
  /** Off-viewport: display:none (tldraw culling - stays in DOM, no paint). */
  culled?: boolean | undefined;
  /** Level of detail: "low" renders lightweight proxy box (zoomed far out). */
  lod?: "full" | "low" | undefined;
  /** Resolves a workspace-relative file path to a displayable URL. */
  resolveMedia?: ((rel: string) => string) | undefined;
  /** OS-native icon fallback for typed tiles: rel -> media URL or null. */
  resolveIcon?: ((rel: string) => Promise<string | null>) | undefined;
  /** Shell thumbnail fallback for typed tiles (video frames, codecs). */
  resolveThumb?: ((rel: string) => Promise<string | null>) | undefined;
  /** Text excerpt for document file nodes (loaded by the platform). */
  excerpt?: string | undefined;
  /** Byte size for typed tiles (loaded by the platform). */
  fileSize?: number | undefined;
  /** Text-node edit mode (controlled by the platform for new nodes). */
  editing?: boolean;
  /** File-node content edit: full file text loaded by the platform. */
  fileEditText?: string | undefined;
  /** Ink sidecar strokes for this node (parsed by the platform). */
  ink?: InkStroke[] | undefined;
  /** Board ink mode - draw/erase/edit reroute pointer gestures on file nodes. */
  inkMode?: "off" | "draw" | "erase" | "edit" | undefined;
  /** additive = shift/ctrl held: toggle membership instead of replacing. */
  onSelect: (id: string, additive: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onCommit: () => void;
  onTextCommit?: (id: string, text: string) => void;
  /** File-content edit finished; text is the new file body (FR-104). */
  onFileCommit?: ((id: string, text: string) => void) | undefined;
  onFileEditCancel?: ((id: string) => void) | undefined;
  /** Double-click a text-kind file node -> in-place content edit. */
  onEditFile?: ((node: CanvasNode) => void) | undefined;
  /** Ink session callbacks - points are node-local px (FR-105/106). */
  onInkStart?:
    ((nodeId: string, lx: number, ly: number, p: number) => void) | undefined;
  onInkMove?:
    ((nodeId: string, lx: number, ly: number, p: number) => void) | undefined;
  onInkEnd?: ((nodeId: string) => void) | undefined;
  onInkErase?: ((nodeId: string, lx: number, ly: number) => void) | undefined;
  /** Ink edit mode: a stroke was dragged by (dx, dy) node-local px. */
  onInkStrokeMove?:
    | ((nodeId: string, strokeIndex: number, dx: number, dy: number) => void)
    | undefined;
  onDraftStart?: (nodeId: string, side: Side) => void;
  onDraftMove?: (wx: number, wy: number) => void;
  onDraftEnd?: (wx: number, wy: number) => void;
  /** Double-click on an image file node (PureRef/Eagle inspect gesture). */
  onInspect?: ((nodeId: string) => void) | undefined;
  /** Double-click on a non-image file node -> OS default app (open-with). */
  onOpenExternal?: ((file: string) => void) | undefined;
  /** Alt+double-click on a file node -> reveal in the OS file manager. */
  onReveal?: ((file: string) => void) | undefined;
  /** Right-click on the node -> context menu at client coords. */
  onContextMenu?:
    ((node: CanvasNode, cx: number, cy: number) => void) | undefined;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Eagle-style typed tile: the file is identified even with no preview. */
/** path -> shared thumb->icon lookup promise (one OS round per path). */
const iconCache = new Map<string, Promise<string | null>>();

function TypedTile(props: {
  kind: FileKind;
  path: string;
  size?: number | undefined;
  resolveIcon?: ((rel: string) => Promise<string | null>) | undefined;
  /** Shell thumbnail (Explorer preview frames, codec-installed types). */
  resolveThumb?: ((rel: string) => Promise<string | null>) | undefined;
}) {
  const ext = props.path.includes(".")
    ? (props.path.split(".").pop() ?? "?").toUpperCase()
    : "?";
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    if (!props.resolveThumb && !props.resolveIcon) return;
    // Every mount subscribes to the shared promise: a re-run effect (the
    // props are fresh closures each render) re-subscribes and .then fires
    // immediately on an already-resolved value - no suppressed setIcon.
    let p = iconCache.get(props.path);
    if (!p) {
      const { resolveThumb, resolveIcon } = props;
      p = (async () => {
        if (resolveThumb) {
          const u = await resolveThumb(props.path);
          if (u) return u;
        }
        return resolveIcon ? await resolveIcon(props.path) : null;
      })();
      iconCache.set(props.path, p);
    }
    let live = true;
    p.then((url) => {
      if (live && url) setIcon(url);
    });
    return () => {
      live = false;
    };
  }, [props.path, props.resolveThumb, props.resolveIcon]);
  return (
    <div className="node-tile">
      {icon ? (
        <img className="node-tile-icon" src={icon} alt="" draggable={false} />
      ) : (
        <span className="node-tile-ext">{ext}</span>
      )}
      <span className="node-tile-kind">
        {props.kind}
        {props.size !== undefined ? ` · ${fmtSize(props.size)}` : ""}
      </span>
    </div>
  );
}

/** Eagle previews fonts; the FontFace API makes it nearly free here. */
function FontPreview(props: { url: string; family: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const face = new FontFace(props.family, `url("${props.url}")`);
    face
      .load()
      .then((f) => {
        if (live) {
          document.fonts.add(f);
          setReady(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      // FontFace entries are document-global; unregister on unmount or
      // remounts accumulate duplicate faces for the same family name.
      if (face.status !== "unloaded") document.fonts.delete(face);
    };
  }, [props.url, props.family]);
  return (
    <div
      className="node-font"
      style={ready ? { fontFamily: props.family } : undefined}
    >
      AaBbGg
      <span className="node-font-sub">0123456789</span>
    </div>
  );
}

/** CSV/TSV renders as a mini table - first rows and columns only. */
function CsvPreview(props: { text: string; tsv: boolean }) {
  const rows = props.text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 6)
    .map((l) => l.split(props.tsv ? "\t" : ",").slice(0, 4));
  return (
    <table className="node-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c.trim()}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A board file on a board: show its shape instead of raw JSON. */
function BoardPreview(props: { text: string }) {
  let stats: string | null = null;
  try {
    const b = JSON.parse(props.text) as {
      nodes?: unknown[];
      edges?: unknown[];
    };
    if (Array.isArray(b.nodes))
      stats = `${b.nodes.length} nodes · ${b.edges?.length ?? 0} edges`;
  } catch {
    /* fall through to excerpt */
  }
  return stats !== null ? (
    <div className="node-boardstats">board · {stats}</div>
  ) : (
    <div className="node-excerpt">{props.text.slice(0, 400)}</div>
  );
}

/** The body of a file node, one presenter per FileKind. */
function FileBody(props: {
  node: CanvasNode & { type: "file" };
  kind: FileKind;
  resolveMedia?: ((rel: string) => string) | undefined;
  resolveIcon?: ((rel: string) => Promise<string | null>) | undefined;
  resolveThumb?: ((rel: string) => Promise<string | null>) | undefined;
  selected: boolean;
  excerpt?: string | undefined;
  fileSize?: number | undefined;
}) {
  const { node, kind } = props;
  const url = props.resolveMedia?.(node.file);
  const caption = <div className="node-caption">{baseName(node.file)}</div>;
  const tile = (
    <TypedTile
      kind={kind}
      path={node.file}
      size={props.fileSize}
      resolveIcon={props.resolveIcon}
      resolveThumb={props.resolveThumb}
    />
  );
  switch (kind) {
    case "image": {
      // Chromium-native formats take <img>; tif/psd decode in JS; heic/jxl
      // go straight to the shell-thumbnail lane (no decoder shipped).
      const ext = node.file.slice(node.file.lastIndexOf(".") + 1).toLowerCase();
      if (url === undefined) return tile;
      if (ext === "heic" || ext === "heif" || ext === "jxl")
        return (
          <>
            {tile}
            {caption}
          </>
        );
      return needsImageDecode(node.file) ? (
        <>
          <DecodedImage url={url} path={node.file} fallback={tile} />
          {caption}
        </>
      ) : (
        <>
          <img
            className="node-media"
            src={url}
            alt={baseName(node.file)}
            draggable={false}
          />
          {caption}
        </>
      );
    }
    case "raw":
      return url !== undefined ? (
        <>
          <RawImage url={url} path={node.file} fallback={tile} />
          {caption}
        </>
      ) : (
        tile
      );
    case "lut":
      return url !== undefined ? (
        <>
          <LutPreview url={url} path={node.file} fallback={tile} />
          {caption}
        </>
      ) : (
        tile
      );
    case "video":
      /* tldraw + AnimRef precedent: video plays inline, muted+looping,
         so a board of clips reads at a glance without stealing audio.
         Codecs Chromium can't play (mkv/avi/prores) fall to the tile,
         whose shell-thumb lane still shows a real frame. */
      return url !== undefined ? (
        <>
          <VideoPreview url={url} path={node.file} fallback={tile} />
          {caption}
        </>
      ) : (
        tile
      );
    case "audio":
      /* Heptabase audioCard precedent: a compact player chip. Waveform
         (WebAudio decode) sits under the badge; controls only when
         selected - ambient boards stay quiet. */
      return url !== undefined ? (
        <>
          <div className="node-audio">
            {props.selected ? (
              <audio
                src={url}
                controls
                data-node-id={node.id}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <WaveformPreview url={url} />
                <span className="node-badge">audio</span>
              </>
            )}
          </div>
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "pdf":
      /* Chromium's PDFium viewer renders served PDFs in an iframe. */
      return url !== undefined ? (
        <>
          <iframe className="node-pdf" src={url} title={node.file} />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "csv":
      return props.excerpt !== undefined ? (
        <>
          <CsvPreview
            text={props.excerpt}
            tsv={node.file.toLowerCase().endsWith(".tsv")}
          />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "board":
      return props.excerpt !== undefined ? (
        <>
          <BoardPreview text={props.excerpt} />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "font":
      return url !== undefined ? (
        <>
          <FontPreview url={url} family={`boxfont-${node.id}`} />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "html":
      /* Sandboxed: renders static layout, scripts stay off. */
      return url !== undefined ? (
        <>
          <HtmlPreview url={url} />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "palette":
      return (
        <>
          <PalettePreview path={node.file} excerpt={props.excerpt} url={url} />
          {caption}
        </>
      );
    case "zip":
      return url !== undefined ? (
        <ZipPreview url={url} path={node.file} />
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "model3d":
      return url !== undefined ? (
        <>
          <ModelPreview
            url={url}
            path={node.file}
            resolveMedia={props.resolveMedia}
            fallback={
              <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
            }
          />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "texture":
      return url !== undefined ? (
        <>
          <TexturePreview
            url={url}
            path={node.file}
            fallback={
              <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
            }
          />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "code":
      return props.excerpt !== undefined ? (
        <>
          <CodeView text={props.excerpt} path={node.file} />
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    case "text":
      return props.excerpt !== undefined ? (
        <>
          <div className="node-excerpt">{props.excerpt}</div>
          {caption}
        </>
      ) : (
        <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
      );
    default:
      /* "other" that sniffed as text gets the excerpt; binaries tile. */
      return props.excerpt !== undefined ? (
        <>
          <div className="node-excerpt">{props.excerpt}</div>
          {caption}
        </>
      ) : (
        <>
          <TypedTile
            kind={kind}
            path={node.file}
            size={props.fileSize}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
          />
          {caption}
        </>
      );
  }
}

function label(n: CanvasNode): string {
  switch (n.type) {
    case "text":
      return n.text.length > 240 ? `${n.text.slice(0, 240)}…` : n.text;
    case "file":
      return baseName(n.file);
    case "link":
      return n.url;
    case "group":
      return n.label ?? "";
  }
}

export const NodeView = memo(function NodeView(props: NodeViewProps) {
  const { node } = props;
  // Live camera for pointer math - read at event time, never re-renders us.
  const camNow = () => props.cameraRef.current ?? DEFAULT_CAMERA;
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);
  const resize = useRef<{
    w: number;
    h: number;
    sx: number;
    sy: number;
  } | null>(null);
  const inking = useRef(false);
  const erasing = useRef(false);
  // Ink edit mode: which stroke is selected + its live drag delta.
  const inkMove = useRef<{ idx: number; sx: number; sy: number } | null>(null);
  const [inkSelIdx, setInkSelIdx] = useState<number | null>(null);
  const [inkDelta, setInkDelta] = useState<{ dx: number; dy: number } | null>(
    null,
  );
  const [selfEditing, setSelfEditing] = useState(false);
  const editing = selfEditing || props.editing === true;
  const [draftText, setDraftText] = useState(
    node.type === "text" ? node.text : "",
  );

  useEffect(() => {
    if (props.editing === true && node.type === "text") setDraftText(node.text);
  }, [props.editing, node]);

  const commitText = (text: string) => {
    setSelfEditing(false);
    props.onTextCommit?.(node.id, text);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation(); // node drags must not become viewport pans
    // Ink modes take over the gesture on file nodes (FR-105/106).
    if (props.inkMode === "draw" && node.type === "file") {
      const w = worldOf(e);
      inking.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      props.onInkStart?.(node.id, w.x - node.x, w.y - node.y, e.pressure);
      return;
    }
    if (props.inkMode === "erase" && node.type === "file") {
      const w = worldOf(e);
      erasing.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      props.onInkErase?.(node.id, w.x - node.x, w.y - node.y);
      return;
    }
    if (props.inkMode === "edit" && node.type === "file") {
      const w = worldOf(e);
      const lx = w.x - node.x;
      const ly = w.y - node.y;
      // Topmost stroke wins - distance picking, not strict interior:
      // a click near a thin ribbon means "that stroke" (tldraw pattern).
      const strokes = props.ink ?? [];
      const hit = pickStroke(strokes, lx, ly, 12 / camNow().z);
      setInkSelIdx(hit >= 0 ? hit : null);
      if (hit >= 0) {
        inkMove.current = { idx: hit, sx: lx, sy: ly };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }
      return;
    }
    drag.current = { px: e.clientX, py: e.clientY, ox: node.x, oy: node.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onSelect(node.id, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (inking.current) {
      const w = worldOf(e);
      props.onInkMove?.(node.id, w.x - node.x, w.y - node.y, e.pressure);
      return;
    }
    if (erasing.current) {
      const w = worldOf(e);
      props.onInkErase?.(node.id, w.x - node.x, w.y - node.y);
      return;
    }
    if (inkMove.current) {
      const w = worldOf(e);
      setInkDelta({
        dx: w.x - node.x - inkMove.current.sx,
        dy: w.y - node.y - inkMove.current.sy,
      });
      return;
    }
    if (!drag.current) return;
    const a = screenToWorld(camNow(), 0, 0);
    const b = screenToWorld(
      camNow(),
      e.clientX - drag.current.px,
      e.clientY - drag.current.py,
    );
    props.onMove(
      node.id,
      Math.round(drag.current.ox + b.x - a.x),
      Math.round(drag.current.oy + b.y - a.y),
    );
  };

  const onPointerUp = () => {
    if (inking.current) {
      inking.current = false;
      props.onInkEnd?.(node.id);
    }
    if (erasing.current) {
      erasing.current = false;
      props.onInkEnd?.(node.id);
    }
    if (inkMove.current) {
      const m = inkMove.current;
      inkMove.current = null;
      const d = inkDelta;
      setInkDelta(null);
      if (d !== null && (d.dx !== 0 || d.dy !== 0)) {
        props.onInkStrokeMove?.(node.id, m.idx, d.dx, d.dy);
      }
    }
    if (drag.current) {
      drag.current = null;
      props.onCommit();
    }
  };

  const worldOf = (e: React.PointerEvent) => {
    const vp = (e.currentTarget as Element).closest(".canvas-viewport");
    const r = vp?.getBoundingClientRect();
    return screenToWorld(
      camNow(),
      e.clientX - (r?.left ?? 0),
      e.clientY - (r?.top ?? 0),
    );
  };

  const handleDown = (side: Side) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onDraftStart?.(node.id, side);
  };
  const handleMove = (e: React.PointerEvent) => {
    const w = worldOf(e);
    props.onDraftMove?.(w.x, w.y);
  };
  const handleUp = (e: React.PointerEvent) => {
    const w = worldOf(e);
    props.onDraftEnd?.(w.x, w.y);
  };

  const resizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = worldOf(e);
    resize.current = { w: node.width, h: node.height, sx: w.x, sy: w.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const resizeMove = (e: React.PointerEvent) => {
    if (!resize.current) return;
    const w = worldOf(e);
    props.onResize?.(
      node.id,
      Math.max(
        MIN_NODE,
        Math.round(resize.current.w + w.x - resize.current.sx),
      ),
      Math.max(
        MIN_NODE,
        Math.round(resize.current.h + w.y - resize.current.sy),
      ),
    );
  };
  const resizeUp = () => {
    if (resize.current) {
      resize.current = null;
      props.onCommit();
    }
  };

  const tint = nodeTint(node.color);
  const cls = [
    "node",
    `node-${node.type}`,
    props.selected ? "selected" : "",
    props.broken ? "broken" : "",
    props.dropTarget ? "drop-target" : "",
    tint !== null ? "tinted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const override = node.type === "file" ? node["box-media"]?.kind : undefined;
  const kind: FileKind | null =
    node.type === "file"
      ? ((override === "doc" ? "text" : override) ?? fileKind(node.file))
      : null;

  return (
    <div
      className={cls}
      data-node-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        ...(props.culled === true ? { display: "none" } : {}),
        ...(tint !== null
          ? ({ "--node-tint": tint } as React.CSSProperties)
          : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        inking.current = false;
        erasing.current = false;
        inkMove.current = null;
        setInkDelta(null);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (props.inkMode !== undefined && props.inkMode !== "off") return;
        if (node.type === "text") setSelfEditing(true);
        else if (node.type === "file") {
          if (e.altKey) props.onReveal?.(node.file);
          else if (kind === "image") props.onInspect?.(node.id);
          else if (kind === "text" || kind === "code") props.onEditFile?.(node);
          else props.onOpenExternal?.(node.file);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onContextMenu?.(node, e.clientX, e.clientY);
      }}
    >
      {node.type === "file" && kind !== null && (
        <span className="node-kind">{kind}</span>
      )}
      {props.broken && <span className="node-flag">missing</span>}
      {props.lod === "low" ? (
        <div className="node-proxy">{label(node)}</div>
      ) : node.type === "file" &&
      props.editing &&
      (kind === "text" || kind === "code") ? (
        <textarea
          className="node-edit"
          autoFocus
          defaultValue={props.fileEditText ?? ""}
          onBlur={(e) => props.onFileCommit?.(node.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
              props.onFileCommit?.(
                node.id,
                (e.target as HTMLTextAreaElement).value,
              );
            if (e.key === "Escape") props.onFileEditCancel?.(node.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      ) : node.type === "file" && kind !== null ? (
        <FileBody
          node={node}
          kind={kind}
          resolveMedia={props.resolveMedia}
          resolveIcon={props.resolveIcon}
          resolveThumb={props.resolveThumb}
          selected={props.selected}
          excerpt={props.excerpt}
          fileSize={props.fileSize}
        />
      ) : node.type === "text" && editing ? (
        <textarea
          className="node-edit"
          autoFocus
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => commitText(draftText)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
              commitText(draftText);
            if (e.key === "Escape") setSelfEditing(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="node-label">{label(node)}</div>
      )}
      {node.type === "group" &&
        typeof node["box-region"] === "object" &&
        node["box-region"] !== null && (
          <div className="region-badge" aria-hidden>
            {(node["box-region"] as { locked?: boolean }).locked === true
              ? "region · locked"
              : "region"}
          </div>
        )}
      {props.lod !== "low" &&
        node.type === "file" &&
        props.ink !== undefined &&
        props.ink.length > 0 && (
          <svg
            className="node-ink"
            viewBox={`0 0 ${node.width} ${node.height}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {props.ink.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill={inkStrokeColor(s, "#e8b931")}
                className={
                  props.inkMode === "edit" && inkSelIdx === i
                    ? "ink-selected"
                    : undefined
                }
                transform={
                  inkMove.current !== null &&
                  inkSelIdx === i &&
                  inkDelta !== null
                    ? `translate(${inkDelta.dx} ${inkDelta.dy})`
                    : undefined
                }
              />
            ))}
          </svg>
        )}
      {props.lod !== "low" &&
        SIDES.map((side) => (
          <div
            key={side}
            className="node-handle"
            data-side={side}
            style={HANDLE_POS[side]}
            onPointerDown={handleDown(side)}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
          />
        ))}
      {props.selected && (
        <div
          className="node-resize"
          onPointerDown={resizeDown}
          onPointerMove={resizeMove}
          onPointerUp={resizeUp}
        />
      )}
    </div>
  );
});
