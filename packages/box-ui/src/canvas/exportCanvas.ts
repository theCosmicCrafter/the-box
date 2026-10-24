// SPDX-License-Identifier: LicenseRef-Proprietary
// exportCanvas - Client-side high-fidelity snapshot exporter for The Box.
// Generates standalone SVG and rasterizes to PNG blobs via offscreen canvas.
// ADR-0013: Zero-cloud, local-first, preserves exact geometric coordinates.

import type { Board, CanvasNode } from "@box/core";
import { anchor, edgeMidpoint, edgePathD } from "./EdgeLayer.js";
import { nodeTint } from "./NodeView.js";

export interface ExportOptions {
  nodeIds?: string[] | undefined;
  padding?: number | undefined;
  background?: string | undefined;
  scale?: number | undefined;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function computeExportBounds(
  nodes: CanvasNode[],
  padding = 40,
): { minX: number; minY: number; width: number; height: number } {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, width: 800, height: 600 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const w = maxX - minX + padding * 2;
  const h = maxY - minY + padding * 2;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: Math.max(100, Math.round(w)),
    height: Math.max(100, Math.round(h)),
  };
}

export function exportBoardToSvg(
  board: Board,
  options?: ExportOptions,
): string {
  const targetIds = options?.nodeIds ? new Set(options.nodeIds) : null;
  const nodes = targetIds
    ? board.nodes.filter((n) => targetIds.has(n.id))
    : board.nodes;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const padding = options?.padding ?? 40;
  const bounds = computeExportBounds(nodes, padding);
  const bg = options?.background ?? "#0e1117";

  const edges = board.edges.filter((e) => {
    return nodeMap.has(e.fromNode) && nodeMap.has(e.toNode);
  });

  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" style="background-color: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`,
  );

  // Marker definitions
  svgParts.push(`  <defs>
    <marker id="export-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6e7681" />
    </marker>
  </defs>`);

  // Draw background rect
  svgParts.push(
    `  <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${bg}" />`,
  );

  // Draw edges
  for (const e of edges) {
    const from = nodeMap.get(e.fromNode);
    const to = nodeMap.get(e.toNode);
    if (!from || !to) continue;

    const a1 = anchor(from, e.fromSide ?? "right");
    const a2 = anchor(to, e.toSide ?? "left");
    const d = edgePathD(a1, a2);
    const mid = edgeMidpoint(a1, a2);
    const strokeColor = nodeTint(e.color) ?? "#6e7681";
    const lineDash =
      e.lineStyle === "dashed"
        ? 'stroke-dasharray="6,4"'
        : e.lineStyle === "dotted"
          ? 'stroke-dasharray="2,3"'
          : "";

    const markerEnd = e.toEnd === "none" ? "" : 'marker-end="url(#export-arrow)"';
    const markerStart =
      e.fromEnd === "arrow" ? 'marker-start="url(#export-arrow)"' : "";

    svgParts.push(
      `  <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="2" ${lineDash} ${markerStart} ${markerEnd} />`,
    );

    if (e.label) {
      svgParts.push(
        `  <rect x="${mid.x - 30}" y="${mid.y - 10}" width="60" height="20" rx="4" fill="#161b22" stroke="#30363d" />`,
      );
      svgParts.push(
        `  <text x="${mid.x}" y="${mid.y + 4}" fill="#e6edf3" font-size="11" text-anchor="middle">${escapeXml(e.label)}</text>`,
      );
    }
  }

  // Draw nodes
  for (const n of nodes) {
    const tint = nodeTint(n.color);
    const borderColor = tint ?? "#30363d";
    const fillBg = "#161b22";

    if (n.type === "group") {
      svgParts.push(
        `  <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="rgba(255,255,255,0.02)" stroke="${borderColor}" stroke-width="2" stroke-dasharray="4,4" />`,
      );
      if ("label" in n && typeof n.label === "string" && n.label) {
        svgParts.push(
          `  <text x="${n.x + 12}" y="${n.y + 22}" fill="#8b949e" font-size="13" font-weight="bold">${escapeXml(n.label)}</text>`,
        );
      }
      continue;
    }

    svgParts.push(
      `  <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${fillBg}" stroke="${borderColor}" stroke-width="1.5" />`,
    );

    // Node header / title
    const headerTitle =
      n.type === "file" && "file" in n
        ? (n.file as string).split("/").pop() ?? n.file
        : n.type.toUpperCase();
    svgParts.push(
      `  <rect x="${n.x}" y="${n.y}" width="${n.width}" height="28" rx="8" fill="rgba(255,255,255,0.04)" />`,
    );
    svgParts.push(
      `  <text x="${n.x + 10}" y="${n.y + 18}" fill="#8b949e" font-size="11" font-weight="600">${escapeXml(headerTitle)}</text>`,
    );

    // Node body preview
    if (n.type === "text" && "text" in n && typeof n.text === "string" && n.text) {
      const snippet = n.text.slice(0, 100).replace(/\n/g, " ");
      svgParts.push(
        `  <text x="${n.x + 10}" y="${n.y + 46}" fill="#c9d1d9" font-size="12">${escapeXml(snippet)}</text>`,
      );
    }
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}

export async function exportSvgToPngBlob(
  svgString: string,
  scale = 2,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svgEl = doc.documentElement;
    const width = parseFloat(svgEl.getAttribute("width") || "800");
    const height = parseFloat(svgEl.getAttribute("height") || "600");

    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to create canvas 2d context"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG into Image for rasterization"));
    };

    img.src = url;
  });
}

export function triggerDownload(
  data: Blob | string,
  filename: string,
): void {
  const blob = typeof data === "string" ? new Blob([data], { type: "image/svg+xml" }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
