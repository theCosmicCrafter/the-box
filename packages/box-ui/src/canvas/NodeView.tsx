// SPDX-License-Identifier: LicenseRef-Proprietary
// NodeView - per-kind DOM renderer + drag/select + edge-draft handles.
// File nodes render real content: images via a resolveMedia callback
// (desktop wires it to the box:// protocol), text/markdown via excerpt.
// Text nodes edit in place on double-click. Selected nodes get a resize
// handle (bottom-right). Broken file nodes keep geometry and render
// visibly broken (I-7). Side handles appear on hover/selected (tldraw
// pattern): drag from one to start a connection draft.

import type { CanvasNode, FileKind, Side } from "@box/core";
import { baseName, fileKind } from "@box/core";
import { useEffect, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { screenToWorld } from "./camera.js";
import {
  CodeView,
  HtmlPreview,
  ModelPreview,
  PalettePreview,
  TexturePreview,
  WaveformPreview,
  ZipPreview,
} from "./previews.js";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const HANDLE_POS: Record<Side, React.CSSProperties> = {
  top: { left: "50%", top: 0 },
  right: { left: "100%", top: "50%" },
  bottom: { left: "50%", top: "100%" },
  left: { left: 0, top: "50%" },
};

const MIN_NODE = 40;

export interface NodeViewProps {
  node: CanvasNode;
  camera: Camera;
  selected: boolean;
  broken: boolean;
  dropTarget?: boolean;
  /** Resolves a workspace-relative file path to a displayable URL. */
  resolveMedia?: ((rel: string) => string) | undefined;
  /** Text excerpt for document file nodes (loaded by the platform). */
  excerpt?: string | undefined;
  /** Byte size for typed tiles (loaded by the platform). */
  fileSize?: number | undefined;
  /** Text-node edit mode (controlled by the platform for new nodes). */
  editing?: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onCommit: () => void;
  onTextCommit?: (id: string, text: string) => void;
  onDraftStart?: (nodeId: string, side: Side) => void;
  onDraftMove?: (wx: number, wy: number) => void;
  onDraftEnd?: (wx: number, wy: number) => void;
  /** Double-click on an image file node (PureRef/Eagle inspect gesture). */
  onInspect?: ((nodeId: string) => void) | undefined;
  /** Double-click on a non-image file node -> OS default app (open-with). */
  onOpenExternal?: ((file: string) => void) | undefined;
  /** Alt+double-click on a file node -> reveal in the OS file manager. */
  onReveal?: ((file: string) => void) | undefined;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Eagle-style typed tile: the file is identified even with no preview. */
function TypedTile(props: {
  kind: FileKind;
  path: string;
  size?: number | undefined;
}) {
  const ext = props.path.includes(".")
    ? (props.path.split(".").pop() ?? "?").toUpperCase()
    : "?";
  return (
    <div className="node-tile">
      <span className="node-tile-ext">{ext}</span>
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
  selected: boolean;
  excerpt?: string | undefined;
  fileSize?: number | undefined;
}) {
  const { node, kind } = props;
  const url = props.resolveMedia?.(node.file);
  const caption = <div className="node-caption">{baseName(node.file)}</div>;
  switch (kind) {
    case "image":
      return url !== undefined ? (
        <>
          <img
            className="node-media"
            src={url}
            alt={baseName(node.file)}
            draggable={false}
          />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "video":
      /* tldraw + AnimRef precedent: video plays inline, muted+looping,
         so a board of clips reads at a glance without stealing audio. */
      return url !== undefined ? (
        <>
          <video
            className="node-media"
            src={url}
            muted
            loop
            autoPlay
            playsInline
            onPointerDown={(e) => e.stopPropagation()}
          />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
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
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "pdf":
      /* Chromium's PDFium viewer renders served PDFs in an iframe. */
      return url !== undefined ? (
        <>
          <iframe className="node-pdf" src={url} title={node.file} />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
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
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "board":
      return props.excerpt !== undefined ? (
        <>
          <BoardPreview text={props.excerpt} />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "font":
      return url !== undefined ? (
        <>
          <FontPreview url={url} family={`boxfont-${node.id}`} />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "html":
      /* Sandboxed: renders static layout, scripts stay off. */
      return url !== undefined ? (
        <>
          <HtmlPreview url={url} />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
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
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "model3d":
      return url !== undefined ? (
        <>
          <ModelPreview
            url={url}
            path={node.file}
            fallback={
              <TypedTile kind={kind} path={node.file} size={props.fileSize} />
            }
          />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "texture":
      return url !== undefined ? (
        <>
          <TexturePreview
            url={url}
            path={node.file}
            fallback={
              <TypedTile kind={kind} path={node.file} size={props.fileSize} />
            }
          />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "code":
      return props.excerpt !== undefined ? (
        <>
          <CodeView text={props.excerpt} path={node.file} />
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
      );
    case "text":
      return props.excerpt !== undefined ? (
        <>
          <div className="node-excerpt">{props.excerpt}</div>
          {caption}
        </>
      ) : (
        <TypedTile kind={kind} path={node.file} size={props.fileSize} />
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
          <TypedTile kind={kind} path={node.file} size={props.fileSize} />
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

export function NodeView(props: NodeViewProps) {
  const { node, camera } = props;
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
    drag.current = { px: e.clientX, py: e.clientY, ox: node.x, oy: node.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onSelect(node.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const a = screenToWorld(camera, 0, 0);
    const b = screenToWorld(
      camera,
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
    if (drag.current) {
      drag.current = null;
      props.onCommit();
    }
  };

  const worldOf = (e: React.PointerEvent) => {
    const vp = (e.currentTarget as Element).closest(".canvas-viewport");
    const r = vp?.getBoundingClientRect();
    return screenToWorld(
      camera,
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

  const cls = [
    "node",
    `node-${node.type}`,
    props.selected ? "selected" : "",
    props.broken ? "broken" : "",
    props.dropTarget ? "drop-target" : "",
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
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (node.type === "text") setSelfEditing(true);
        else if (node.type === "file") {
          if (e.altKey) props.onReveal?.(node.file);
          else if (kind === "image") props.onInspect?.(node.id);
          else props.onOpenExternal?.(node.file);
        }
      }}
    >
      {node.type === "file" && kind !== null && (
        <span className="node-kind">{kind}</span>
      )}
      {props.broken && <span className="node-flag">missing</span>}
      {node.type === "file" && kind !== null ? (
        <FileBody
          node={node}
          kind={kind}
          resolveMedia={props.resolveMedia}
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
      {SIDES.map((side) => (
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
}
