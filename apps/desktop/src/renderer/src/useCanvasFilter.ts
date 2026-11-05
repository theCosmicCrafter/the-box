// SPDX-License-Identifier: LicenseRef-Proprietary
// useCanvasFilter.ts - Track 4 canvas search & filter overlay: query/
// kind state, matched-node ids, the dimmed set for non-matches, and
// prev/next match navigation (camera jumps to each hit). Extracted
// from App.tsx.

import type { Board } from "@box/core";
import type { FilterKind } from "@box/ui";
import { matchNode } from "@box/ui";
import { useMemo, useState } from "react";

export function useCanvasFilter(deps: {
  board: Board | null;
  fileTexts: Map<string, string>;
  jumpToNode: (id: string) => void;
}) {
  const { board, fileTexts, jumpToNode } = deps;
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [filterMatchIdx, setFilterMatchIdx] = useState(0);

  const matchedNodeIds = useMemo(() => {
    if (!board) return [];
    return board.nodes
      .filter((n) => matchNode(n, filterQuery, filterKind, fileTexts))
      .map((n) => n.id);
  }, [board, filterQuery, filterKind, fileTexts]);

  const dimmedNodes = useMemo(() => {
    const hasActiveFilter =
      filterOpen && (filterQuery.trim().length > 0 || filterKind !== "all");
    if (!hasActiveFilter || !board) return undefined;
    const matched = new Set(matchedNodeIds);
    const dimmed = new Set<string>();
    for (const n of board.nodes) {
      if (!matched.has(n.id)) dimmed.add(n.id);
    }
    return dimmed;
  }, [filterOpen, filterQuery, filterKind, board, matchedNodeIds]);

  const nextFilterMatch = () => {
    if (matchedNodeIds.length === 0) return;
    const next = (filterMatchIdx + 1) % matchedNodeIds.length;
    setFilterMatchIdx(next);
    const nid = matchedNodeIds[next];
    if (nid) jumpToNode(nid);
  };

  const prevFilterMatch = () => {
    if (matchedNodeIds.length === 0) return;
    const prev =
      (filterMatchIdx - 1 + matchedNodeIds.length) % matchedNodeIds.length;
    setFilterMatchIdx(prev);
    const nid = matchedNodeIds[prev];
    if (nid) jumpToNode(nid);
  };

  return {
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
  };
}
