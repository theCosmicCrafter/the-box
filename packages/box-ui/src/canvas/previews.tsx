// SPDX-License-Identifier: LicenseRef-Proprietary
// previews.tsx - heavy presenters for file kinds that need real parsing.
// Split from NodeView so the node shell stays about drag/select/resize.
// Grounded in Eagle 4.0's shipped architecture (.tmp-eagle extraction):
// three.js for models+textures, fflate for zip-family thumbnails,
// FontFace for fonts, WebAudio for waveforms, PDFium for pdf.
// Every presenter fails soft - a tile beats a broken embed.

import { baseName } from "@box/core";
import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

// ---------- shared async plumbing ----------

function useAsyncData<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; err: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false);
    setData(null);
    fn()
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setErr(true);
      });
    return () => {
      live = false;
    };
    // fn identity changes each render; deps carry the real inputs
  }, deps);
  return { data, err };
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r.arrayBuffer();
}

// ---------- code: syntax highlighting ----------

type Tok = { c: "k" | "s" | "c" | "n" | "p" | "t"; v: string };

const C_LIKE = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "java",
  "kt",
  "rs",
  "go",
  "swift",
  "glsl",
  "frag",
  "vert",
  "geom",
  "comp",
  "tesc",
  "tese",
  "wgsl",
  "hlsl",
  "fx",
  "fxh",
  "cginc",
  "shader",
  "usf",
  "lua",
  "dart",
]);
const HASH_COMMENT = new Set([
  "py",
  "sh",
  "bash",
  "zsh",
  "rb",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "ps1",
  "r",
]);
const KW = new Set(
  `if else for while do switch case break continue return function fn func def class struct enum interface impl trait pub mod use import from export default const let var static void int uint float double bool char long short unsigned signed true false null nil none undefined this self super new delete typeof instanceof in of async await try catch finally throw raises yield match where mut ref move and or not is lambda pass elif global nonlocal with as assert defer package extends implements private protected public internal override virtual abstract sealed readonly volatile extern unsafe inline constexpr template typename namespace require type keyof never any unknown string number boolean object symbol out inout uniform attribute varying layout precision highp mediump lowp buffer shared restrict readonly writeonly coherent vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4 mat2 mat3 mat4 dmat3 dmat4 sampler2D sampler3D samplerCube texture2D texture textureProj mix clamp dot cross normalize reflect refract smoothstep step length distance fract floor ceil abs min max pow exp log sqrt inversesqrt sin cos tan atan radians degrees sign`.split(
    " ",
  ),
);

/**
 * Tokenize code for display: comments, strings, numbers, keywords,
 * preprocessor lines. Not a parser - a highlighter. Wrong guesses are
 * cosmetic, never destructive.
 */
export function highlightCode(text: string, ext: string): Tok[] {
  const toks: Tok[] = [];
  const e = ext.toLowerCase();
  const cLike = C_LIKE.has(e);
  const hash = HASH_COMMENT.has(e);
  // ordered alternation: preprocessor/directive, block comment, line
  // comment, string, number, word. Leftmost alternation wins.
  const parts: string[] = [];
  const preproc = cLike; // #version / #include / ...
  const attr = cLike || e === "wgsl" || e === "hlsl"; // @vertex @group(0)
  if (preproc) parts.push("(?:^|\\n)[ \\t]*#[^\\n]*");
  if (attr) parts.push("@[A-Za-z_][A-Za-z0-9_]*(?:\\([^()\\n]*\\))?");
  if (cLike) parts.push("\\/\\*[\\s\\S]*?\\*\\/");
  const lineComment = cLike ? "\\/\\/[^\\n]*" : hash ? "#[^\\n]*" : null;
  if (lineComment) parts.push(lineComment);
  parts.push("'(?:\\\\.|[^'\\\\\\n])*'");
  parts.push('"(?:\\\\.|[^"\\\\\\n])*"');
  parts.push("`(?:\\\\.|[^`\\\\])*`");
  parts.push("\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[fFulLxXbB]?\\b");
  parts.push("[A-Za-z_][A-Za-z0-9_]*");
  const re = new RegExp(parts.join("|"), "g");
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > i) toks.push({ c: "t", v: text.slice(i, m.index) });
    const v = m[0];
    if (preproc && /^(?:\n)?[ \t]*#/.test(v)) {
      // leading newline stays plain text; the directive colors "p"
      if (v.startsWith("\n")) {
        toks.push({ c: "t", v: "\n" });
        toks.push({ c: "p", v: v.slice(1) });
      } else toks.push({ c: "p", v });
    } else if (/^@/.test(v)) toks.push({ c: "p", v });
    else if (
      v.startsWith("/*") ||
      v.startsWith("//") ||
      (hash && v.startsWith("#"))
    )
      toks.push({ c: "c", v });
    else if (v.startsWith("'") || v.startsWith('"') || v.startsWith("`"))
      toks.push({ c: "s", v });
    else if (/^\d/.test(v)) toks.push({ c: "n", v });
    else if (KW.has(v)) toks.push({ c: "k", v });
    else toks.push({ c: "t", v });
    i = m.index + v.length;
  }
  if (i < text.length) toks.push({ c: "t", v: text.slice(i) });
  return toks;
}

export function CodeView(props: { text: string; path: string }) {
  const ext = props.path.slice(props.path.lastIndexOf(".") + 1);
  const toks = highlightCode(props.text, ext);
  return (
    <pre className="node-code">
      {toks.map((t, i) => (
        <span key={i} className={`tok-${t.c}`}>
          {t.v}
        </span>
      ))}
    </pre>
  );
}

// ---------- palette: gpl / pal / hex text + ase binary ----------

function parseGpl(text: string): string[] {
  const colors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (m) colors.push(`rgb(${m[1]},${m[2]},${m[3]})`);
  }
  return colors;
}

function parsePal(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!/^JASC-PAL/i.test(lines[0] ?? "")) return parseGpl(text);
  const colors: string[] = [];
  for (const line of lines.slice(3)) {
    const m = line.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (m) colors.push(`rgb(${m[1]},${m[2]},${m[3]})`);
  }
  return colors;
}

function parseHex(text: string): string[] {
  return text
    .split(/[\r\n,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^#?[0-9a-fA-F]{6}$/.test(t))
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

/** Adobe .ase: "ASEF" magic, u32 blocks; color blocks carry a color mode
 *  + float channels. We take RGB/Gray; CMYK/LAB convert coarsely or skip. */
export function parseAse(buf: ArrayBuffer): string[] {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0) !== 0x41534546) return [];
  const blocks = dv.getUint32(8);
  const colors: string[] = [];
  let off = 12;
  for (let b = 0; b < blocks && off + 6 <= buf.byteLength; b++) {
    const type = dv.getUint16(off);
    const len = dv.getUint32(off + 2);
    const start = off + 6;
    if (type === 0x0001 || type === 0x0002) {
      // color / spot color: skip utf16 name
      let p = start;
      const nameLen = dv.getUint16(p);
      p += 2 + nameLen * 2;
      const mode = String.fromCharCode(
        dv.getUint8(p),
        dv.getUint8(p + 1),
        dv.getUint8(p + 2),
        dv.getUint8(p + 3),
      ).trim();
      p += 4;
      const f = () => dv.getFloat32(p),
        step = () => (p += 4);
      if (mode === "RGB") {
        const r = f();
        step();
        const g = f();
        step();
        const bl = f();
        step();
        colors.push(
          `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(
            bl * 255,
          )})`,
        );
      } else if (mode === "Gray") {
        const g = Math.round(f() * 255);
        colors.push(`rgb(${g},${g},${g})`);
      } else if (mode === "CMYK") {
        const c = f();
        step();
        const m = f();
        step();
        const y = f();
        step();
        const k = f();
        step();
        colors.push(
          `rgb(${Math.round(255 * (1 - c) * (1 - k))},${Math.round(
            255 * (1 - m) * (1 - k),
          )},${Math.round(255 * (1 - y) * (1 - k))})`,
        );
      }
    }
    off = start + len;
  }
  return colors;
}

function SwatchStrip(props: { colors: string[] }) {
  return (
    <div className="node-palette">
      {props.colors.slice(0, 96).map((c, i) => (
        <span key={i} className="node-swatch" style={{ background: c }} />
      ))}
      <span className="node-palette-count">{props.colors.length} colors</span>
    </div>
  );
}

export function PalettePreview(props: {
  path: string;
  excerpt?: string | undefined;
  url?: string | undefined;
}) {
  const isAse = props.path.toLowerCase().endsWith(".ase");
  const { data } = useAsyncData(
    async () =>
      isAse && props.url ? parseAse(await fetchBytes(props.url)) : null,
    [props.url, isAse],
  );
  let colors: string[] = [];
  if (isAse) colors = data ?? [];
  else if (props.excerpt !== undefined) {
    const t = props.excerpt;
    const p = props.path.toLowerCase();
    colors = p.endsWith(".gpl")
      ? parseGpl(t)
      : p.endsWith(".pal")
        ? parsePal(t)
        : parseHex(t);
  }
  if (colors.length === 0)
    return (
      <div className="node-excerpt">
        {props.excerpt ?? baseName(props.path)}
      </div>
    );
  return <SwatchStrip colors={colors} />;
}

// ---------- zip family: thumbnails + listing (fflate, Eagle's own lib) ----------

const ZIP_THUMB_NAMES =
  /(^|\/)(mergedimage|preview|thumbnail|thumb|cover|icon)[^/]*\.(png|jpe?g|webp)$/i;

export function ZipPreview(props: { url: string; path: string }) {
  const { data, err } = useAsyncData(async () => {
    const { unzipSync } = await import("fflate");
    const buf = new Uint8Array(await fetchBytes(props.url));
    const thumbNames: string[] = [];
    // unzipSync with filter: only a thumbnail candidate pays decompression
    const files = unzipSync(buf, {
      filter: (f) => {
        if (ZIP_THUMB_NAMES.test(f.name)) {
          thumbNames.push(f.name);
          return true;
        }
        return false;
      },
    });
    // full entry listing comes from a central-directory walk (names only)
    const names = listZipNames(buf);
    const firstThumb = thumbNames[0];
    const thumb = firstThumb !== undefined ? (files[firstThumb] ?? null) : null;
    // Object URL lives in the data so it is created once per load and can be
    // revoked exactly once (a URL minted inside render leaks every render).
    const thumbUrl =
      thumb === null
        ? null
        : URL.createObjectURL(
            new Blob([thumb.buffer as ArrayBuffer], { type: "image/png" }),
          );
    return { names, thumbUrl };
  }, [props.url]);

  useEffect(() => {
    const u = data?.thumbUrl;
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [data?.thumbUrl]);

  if (err || !data)
    return <div className="node-excerpt">{baseName(props.path)}</div>;
  if (data.thumbUrl !== null) {
    return (
      <>
        <img
          className="node-media"
          src={data.thumbUrl}
          alt={baseName(props.path)}
          draggable={false}
        />
        <div className="node-caption">
          {baseName(props.path)} · {data.names.length} entries
        </div>
      </>
    );
  }
  return (
    <>
      <div className="node-ziplist">
        {data.names.slice(0, 24).map((n, i) => (
          <div key={i}>{n}</div>
        ))}
        {data.names.length > 24 && <div>… {data.names.length - 24} more</div>}
      </div>
      <div className="node-caption">
        {baseName(props.path)} · {data.names.length} entries
      </div>
    </>
  );
}

/** Central-directory walk: names only, no decompression. */
function listZipNames(buf: Uint8Array): string[] {
  // EOCD: last 64KB, signature 0x06054b50
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65558; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    names.push(
      new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen)),
    );
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return names;
}

// ---------- audio waveform ----------

export function WaveformPreview(props: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const buf = await fetchBytes(props.url);
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const audio = await ctx.decodeAudioData(buf.slice(0));
      if (!live || !ref.current) return;
      const cv = ref.current;
      const w = (cv.width = cv.clientWidth || 200);
      const h = (cv.height = cv.clientHeight || 60);
      const g = cv.getContext("2d");
      if (!g) return;
      const ch = audio.getChannelData(0);
      const buckets = Math.min(200, w);
      const per = Math.floor(ch.length / buckets) || 1;
      g.fillStyle = "#6ea3ff";
      const mid = h / 2;
      for (let i = 0; i < buckets; i++) {
        let peak = 0;
        const s = i * per;
        for (let j = 0; j < per; j += 4) {
          const v = Math.abs(ch[s + j] ?? 0);
          if (v > peak) peak = v;
        }
        const bh = Math.max(1, peak * h * 0.9);
        g.fillRect((i * w) / buckets, mid - bh / 2, w / buckets - 1, bh);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [props.url]);
  return <canvas ref={ref} className="node-wave" />;
}

// ---------- 3D models (three.js; Eagle ships o3dv, loaders parity) ----------

export function ModelPreview(props: {
  url: string;
  path: string;
  fallback?: React.ReactNode;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let renderer: THREE_NS.WebGLRenderer | null = null;
    let scene: THREE_NS.Scene | null = null;
    let raf = 0;
    (async () => {
      const THREE = await import("three");
      const ext = props.path
        .slice(props.path.lastIndexOf(".") + 1)
        .toLowerCase();
      if (!mount.current || disposed) return;
      const el = mount.current;
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
      const w = el.clientWidth || 200;
      const h = el.clientHeight || 140;
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const sc = (scene = new THREE.Scene());
      sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1d24, 1.4));
      const dir = new THREE.DirectionalLight(0xffffff, 1.6);
      dir.position.set(3, 5, 4);
      sc.add(dir);
      const cam = new THREE.PerspectiveCamera(40, w / h, 0.01, 5000);

      const load = async (): Promise<THREE_NS.Object3D> => {
        switch (ext) {
          case "glb":
          case "gltf": {
            const { GLTFLoader } =
              await import("three/examples/jsm/loaders/GLTFLoader.js");
            return (await new GLTFLoader().loadAsync(props.url)).scene;
          }
          case "obj": {
            const { OBJLoader } =
              await import("three/examples/jsm/loaders/OBJLoader.js");
            return new OBJLoader().loadAsync(props.url);
          }
          case "stl": {
            const { STLLoader } =
              await import("three/examples/jsm/loaders/STLLoader.js");
            const geo = await new STLLoader().loadAsync(props.url);
            return new THREE.Mesh(
              geo,
              new THREE.MeshStandardMaterial({ color: 0x9fb4d8 }),
            );
          }
          case "ply": {
            const { PLYLoader } =
              await import("three/examples/jsm/loaders/PLYLoader.js");
            const geo = await new PLYLoader().loadAsync(props.url);
            return new THREE.Mesh(
              geo,
              new THREE.MeshStandardMaterial({ color: 0x9fb4d8 }),
            );
          }
          case "fbx": {
            const { FBXLoader } =
              await import("three/examples/jsm/loaders/FBXLoader.js");
            return new FBXLoader().loadAsync(props.url);
          }
          case "dae": {
            const { ColladaLoader } =
              await import("three/examples/jsm/loaders/ColladaLoader.js");
            return (await new ColladaLoader().loadAsync(props.url)).scene;
          }
          case "3ds": {
            const { TDSLoader } =
              await import("three/examples/jsm/loaders/TDSLoader.js");
            return new TDSLoader().loadAsync(props.url);
          }
          case "3mf": {
            const { ThreeMFLoader } =
              await import("three/examples/jsm/loaders/3MFLoader.js");
            return new ThreeMFLoader().loadAsync(props.url);
          }
          default:
            throw new Error(`no loader for ${ext}`);
        }
      };

      try {
        const obj = await load();
        if (disposed) return;
        // frame the object: center + orbit radius from bounding sphere
        const box = new THREE.Box3().setFromObject(obj);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const r = Math.max(sphere.radius, 0.001);
        obj.position.sub(sphere.center);
        sc.add(obj);
        cam.position.set(r * 1.6, r * 0.9, r * 1.9);
        cam.lookAt(0, 0, 0);
        const group = new THREE.Group();
        // rotate around scene center: wrap object
        sc.remove(obj);
        group.add(obj);
        sc.add(group);
        const tick = () => {
          if (disposed) return;
          group.rotation.y += 0.008;
          renderer!.render(sc, cam);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!disposed) setFailed(true);
      }
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      // GPU resources outlive renderer.dispose() otherwise - geometries,
      // materials and embedded textures all need explicit .dispose().
      scene?.traverse((o) => {
        const mesh = o as THREE_NS.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const m of mats) {
          if (m === undefined) continue;
          for (const v of Object.values(m)) {
            if ((v as THREE_NS.Texture | null)?.isTexture === true)
              (v as THREE_NS.Texture).dispose();
          }
          m.dispose();
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      scene = null;
    };
  }, [props.url, props.path]);
  if (failed) return <>{props.fallback ?? null}</>;
  return <div ref={mount} className="node-model" />;
}

// ---------- GPU textures (EXR/HDR/TGA/DDS via three.js; Eagle texture-viewer) ----------

export function TexturePreview(props: {
  url: string;
  path: string;
  fallback?: React.ReactNode;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let renderer: THREE_NS.WebGLRenderer | null = null;
    let tex: THREE_NS.Texture | null = null;
    let meshRef: THREE_NS.Mesh | null = null;
    (async () => {
      const THREE = await import("three");
      const ext = props.path
        .slice(props.path.lastIndexOf(".") + 1)
        .toLowerCase();
      if (!mount.current || disposed) return;
      tex = null;
      try {
        if (ext === "exr") {
          const { EXRLoader } =
            await import("three/examples/jsm/loaders/EXRLoader.js");
          tex = await new EXRLoader().loadAsync(props.url);
        } else if (ext === "hdr") {
          const { RGBELoader } =
            await import("three/examples/jsm/loaders/RGBELoader.js");
          tex = await new RGBELoader().loadAsync(props.url);
        } else if (ext === "tga") {
          const { TGALoader } =
            await import("three/examples/jsm/loaders/TGALoader.js");
          tex = await new TGALoader().loadAsync(props.url);
        } else if (ext === "dds") {
          const { DDSLoader } =
            await import("three/examples/jsm/loaders/DDSLoader.js");
          tex = await new DDSLoader().loadAsync(props.url);
        }
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (!tex || disposed || !mount.current) return;
      const el = mount.current;
      const w = el.clientWidth || 200;
      const h = el.clientHeight || 140;
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setSize(w, h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: true }),
      );
      meshRef = mesh;
      scene.add(mesh);
      renderer.render(scene, cam);
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      meshRef?.geometry.dispose();
      (meshRef?.material as THREE_NS.Material | undefined)?.dispose();
      tex?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      meshRef = null;
      tex = null;
    };
  }, [props.url, props.path]);
  if (failed) return <>{props.fallback ?? null}</>;
  return <div ref={mount} className="node-model" />;
}

// ---------- html preview (sandboxed iframe; Eagle's mhtml.js lane) ----------

export function HtmlPreview(props: { url: string }) {
  return (
    <iframe
      className="node-pdf"
      src={props.url}
      sandbox=""
      title="html preview"
    />
  );
}
