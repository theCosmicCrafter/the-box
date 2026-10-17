// SPDX-License-Identifier: LicenseRef-Proprietary
// QuickOpen - Obsidian-style Ctrl+P palette. Fuzzy subsequence match over
// workspace paths; arrows + enter + esc; click to pick. Pure component -
// the platform supplies the item list and the pick action.

import { useEffect, useMemo, useRef, useState } from "react";

export interface QuickOpenItem {
  path: string;
  kind?: string | undefined;
}

export interface QuickOpenProps {
  items: QuickOpenItem[];
  placeholder?: string | undefined;
  onPick: (path: string) => void;
  onClose: () => void;
}

/** Subsequence fuzzy score: consecutive runs and word starts score higher.
 *  Returns -1 when the query does not match at all. */
function score(query: string, path: string): number {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  let qi = 0;
  let s = 0;
  let run = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] !== q[qi]) {
      run = 0;
      continue;
    }
    run++;
    s += run * 2;
    if (i === 0 || p[i - 1] === "/" || p[i - 1] === "\\" || p[i - 1] === " ")
      s += 10;
    if (p[i] === path[i] && /[A-Z]/.test(path[i] ?? "")) s += 3;
    qi++;
  }
  return qi === q.length ? s - path.length * 0.01 : -1;
}

export function QuickOpen(props: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const scored = props.items
      .map((it) => ({ it, s: score(query, it.path) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, 14).map((r) => r.it);
  }, [props.items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const pick = (i: number) => {
    const it = results[i];
    if (!it) return;
    props.onPick(it.path);
    props.onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(cursor);
    }
  };

  return (
    <div className="quickopen-backdrop" onClick={props.onClose}>
      <div className="quickopen" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="quickopen-input"
          value={query}
          placeholder={props.placeholder ?? "Type a file name..."}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="quickopen-list">
          {results.map((it, i) => (
            <div
              key={it.path}
              className={`quickopen-row ${i === cursor ? "active" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(i)}
            >
              <span className="quickopen-path">{it.path}</span>
              {it.kind && <span className="quickopen-kind">{it.kind}</span>}
            </div>
          ))}
          {results.length === 0 && (
            <div className="quickopen-empty">no matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
