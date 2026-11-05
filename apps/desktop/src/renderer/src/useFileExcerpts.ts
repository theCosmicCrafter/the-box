// SPDX-License-Identifier: LicenseRef-Proprietary
// useFileExcerpts.ts - text excerpts for file nodes: bodies for text
// kinds, rows for csv, whole JSON for boards, plus the printable-byte
// sniff pass for unknown extensions. Extracted from App.tsx; the loader
// is keyed on a stable path:size set so node drags never re-run reads.

import type { Board } from "@box/core";
import { fileKind, looksLikeText } from "@box/core";
import type { WorkspaceFile } from "@box/ui";
import { useEffect, useMemo, useRef, useState } from "react";

const TEXT_KINDS = ["text", "csv", "board", "code", "palette"];
const MAX_READ = 1024 * 1024;
const SNIFF_MAX = 64 * 1024;

export function useFileExcerpts(opts: {
  workspaceRoot: string | null;
  board: Board | null;
  files: WorkspaceFile[];
}) {
  const { workspaceRoot, board, files } = opts;
  const [fileTexts, setFileTexts] = useState<Map<string, string>>(new Map());

  // Text for the kinds that read it: excerpts for text nodes' file
  // bodies, rows for csv tables, JSON for board stats. Skip binaries
  // and anything over 1MB - a log dump is a tile, not a reader.
  const fileSizes = useMemo(
    () => new Map(files.map((f) => [f.path, f.size])),
    [files],
  );
  // The excerpt set only changes when placed files or their sizes do -
  // node drags reorder nothing here, so keying the loader on this string
  // keeps it from re-running (and re-rendering) every gesture frame.
  const excerptKey = useMemo(() => {
    if (!board) return "";
    const parts: string[] = [];
    for (const n of board.nodes) {
      if (n.type !== "file") continue;
      const kind = fileKind(n.file);
      const size = fileSizes.get(n.file) ?? 0;
      if (
        (size <= MAX_READ && TEXT_KINDS.includes(kind)) ||
        (kind === "other" && size <= SNIFF_MAX)
      )
        parts.push(`${n.file}:${size}`);
    }
    return parts.sort().join("|");
  }, [board?.nodes, fileSizes]);
  const fileTextsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    fileTextsRef.current = fileTexts;
  }, [fileTexts]);
  useEffect(() => {
    if (!workspaceRoot || !window.box || !board || excerptKey === "") return;
    const targets = board.nodes
      .filter(
        (n) =>
          n.type === "file" &&
          (fileSizes.get(n.file) ?? 0) <= MAX_READ &&
          TEXT_KINDS.includes(fileKind(n.file)),
      )
      .map((n) => (n.type === "file" ? n.file : ""));
    const sniff = board.nodes.filter(
      (n) =>
        n.type === "file" &&
        fileKind(n.file) === "other" &&
        (fileSizes.get(n.file) ?? 0) <= SNIFF_MAX,
    );
    void (async () => {
      const additions = new Map<string, string>();
      for (const p of targets) {
        if (fileTextsRef.current.has(p) || additions.has(p)) continue;
        const t = await window.box!.readFile(workspaceRoot, p);
        // board JSON needs the whole doc to parse; csv a few rows;
        // excerpts just enough to read.
        const cap =
          fileKind(p) === "board"
            ? 256 * 1024
            : fileKind(p) === "csv"
              ? 8 * 1024
              : 400;
        if (t !== null) additions.set(p, t.slice(0, cap));
      }
      // Sniff pass: unknown extensions get a text excerpt when their
      // bytes are mostly printable - "every text file type" without
      // needing the extension in the table.
      for (const n of sniff) {
        if (n.type !== "file") continue;
        const p = n.file;
        if (fileTextsRef.current.has(p) || additions.has(p)) continue;
        const t = await window.box!.readFile(workspaceRoot, p);
        if (t !== null && looksLikeText(t)) additions.set(p, t.slice(0, 400));
      }
      // No setState when nothing new arrived - drags and unrelated board
      // edits must not churn a fresh Map through the tree every frame.
      if (additions.size === 0) return;
      setFileTexts((prev) => {
        const next = new Map(prev);
        for (const [k, v] of additions) {
          if (!next.has(k)) next.set(k, v);
        }
        return next;
      });
    })();
  }, [excerptKey, workspaceRoot]);

  return { fileTexts, setFileTexts, fileSizes };
}
