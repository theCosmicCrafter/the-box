// SPDX-License-Identifier: LicenseRef-Proprietary
// useSemanticSearch.ts - Track 3 local semantic intelligence
// (ADR-0012): "find related notes" embeddings via the loopback-only
// decidePost bridge (Ollama bge-m3), falling back to box-core's local
// fallbackVector when offline. The session-scoped vector cache means
// identical node text never pays a second loopback call. Extracted
// from App.tsx.

import type { CanvasNode } from "@box/core";
import { fallbackVector, topKSimilar } from "@box/core";
import { useBoxStore } from "@box/ui";
import { useRef, useState } from "react";

export interface RelatedDialogState {
  sourceNode: CanvasNode;
  results: {
    id: string;
    name: string;
    excerpt?: string | undefined;
    score: number;
  }[];
}

export function useSemanticSearch(deps: {
  fileTexts: Map<string, string>;
}) {
  const { fileTexts } = deps;
  const [relatedDialog, setRelatedDialog] =
    useState<RelatedDialogState | null>(null);
  const vecCache = useRef(new Map<string, number[]>());

  const findRelated = async (sourceNode: CanvasNode) => {
    const b = useBoxStore.getState().board;
    if (!b) return;
    const candidates = b.nodes.filter((n) => n.id !== sourceNode.id);
    if (candidates.length === 0) return;

    const getNodeText = (n: CanvasNode): string => {
      if (n.type === "text") return n.text;
      if (n.type === "file")
        return (fileTexts.get(n.file) ?? "") + " " + n.file;
      if (n.type === "link") return (n.label ?? "") + " " + (n.url ?? "");
      if (n.type === "group") return n.label ?? "";
      return "";
    };

    const queryText = getNodeText(sourceNode);
    if (!queryText.trim()) return;

    const getVector = async (text: string): Promise<number[]> => {
      const hit = vecCache.current.get(text);
      if (hit !== undefined) return hit;
      let vec: number[] | null = null;
      try {
        if (window.box?.decidePost) {
          const body = JSON.stringify({
            model: "bge-m3:latest",
            prompt: text.slice(0, 1000),
          });
          const raw = await window.box.decidePost(
            "http://127.0.0.1:11434/api/embeddings",
            body,
          );
          const d = JSON.parse(raw) as { embedding?: number[] };
          if (Array.isArray(d.embedding) && d.embedding.length > 0)
            vec = d.embedding;
        }
      } catch {
        // Local loopback offline fallback
      }
      const out = vec ?? fallbackVector(text);
      if (vecCache.current.size > 2000) vecCache.current.clear();
      vecCache.current.set(text, out);
      return out;
    };

    const queryVec = await getVector(queryText);
    const candidateVecs = new Map<string, number[]>();
    for (const c of candidates) {
      const text = getNodeText(c);
      if (text.trim().length > 0) {
        candidateVecs.set(c.id, await getVector(text));
      }
    }

    const matches = topKSimilar(queryVec, candidateVecs, 5, 0.15);
    const results = matches.map((m) => {
      const n = candidates.find((x) => x.id === m.id)!;
      const rawLabel = (n as { label?: unknown }).label;
      const labelStr = typeof rawLabel === "string" ? rawLabel : n.id;
      const name: string =
        n.type === "file"
          ? n.file
          : n.type === "text"
            ? n.text.slice(0, 40) + "…"
            : labelStr;
      const excerpt = n.type === "file" ? fileTexts.get(n.file) : undefined;
      return {
        id: n.id,
        name,
        excerpt,
        score: Math.round(m.score * 100),
      };
    });

    setRelatedDialog({
      sourceNode,
      results,
    });
  };

  return { relatedDialog, setRelatedDialog, findRelated };
}
