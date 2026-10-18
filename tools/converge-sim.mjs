// Simulates runSync's reconcile pass loop against a real workspace dir.
// Usage: node tools/converge-sim.mjs <wsRoot>
import {
  edgeIdFromNoteName,
  parseBoard,
  parseInkSvg,
  parseLinkNote,
  reconcile,
} from "@box/core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const wsRoot = process.argv[2];
if (!wsRoot) {
  console.error("usage: node tools/converge-sim.mjs <wsRoot>");
  process.exit(1);
}

function walk(dir, prefix, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === ".box" && prefix === "") {
        // scan .box for boards/tombstones but not caches
        walk(join(dir, e.name), rel, out);
      } else if (e.name !== "node_modules" && e.name !== ".git") {
        walk(join(dir, e.name), rel, out);
      }
    } else out.push(rel);
  }
}

function loadState() {
  const files = [];
  walk(wsRoot, "", files);
  const texts = new Map();
  for (const rel of files) {
    if (
      rel.endsWith(".box.canvas") ||
      rel.endsWith(".ink.svg") ||
      (!rel.includes("/") && edgeIdFromNoteName(rel) !== null) ||
      rel === ".box/tombstones.json"
    ) {
      try {
        texts.set(rel, readFileSync(join(wsRoot, ...rel.split("/")), "utf8"));
      } catch {
        // unreadable file - skipped, same as a Rust scan miss
      }
    }
  }
  return { files, texts };
}

function buildScan({ files, texts }) {
  const boards = new Map();
  const notes = new Map();
  const ink = new Map();
  for (const rel of files) {
    const raw = texts.get(rel);
    if (raw === undefined) continue;
    if (rel.endsWith(".box.canvas")) boards.set(rel, parseBoard(raw, rel));
    else if (!rel.includes("/") && edgeIdFromNoteName(rel) !== null)
      notes.set(rel, parseLinkNote(raw, rel));
    else if (rel.endsWith(".ink.svg")) ink.set(rel, parseInkSvg(raw, rel));
  }
  let tombstones = new Set();
  try {
    const p = JSON.parse(texts.get(".box/tombstones.json") ?? "[]");
    if (Array.isArray(p))
      tombstones = new Set(p.filter((x) => typeof x === "string"));
  } catch {
    // malformed ledger - treated as empty, same as sync.ts
  }
  return {
    boards,
    notes,
    ink,
    files: new Set(files),
    tombstones,
    knownNotes: new Set(
      [...notes.keys()].map((p) => edgeIdFromNoteName(p)).filter(Boolean),
    ),
  };
}

let state = loadState();
for (let pass = 0; pass < 8; pass++) {
  const report = reconcile(buildScan(state));
  const steps = report.plan.steps;
  console.log(
    `pass ${pass}: ${steps.length} steps, ${report.problems.length} problems`,
  );
  const byPath = new Map();
  for (const s of steps) {
    const k = s.op === "write-atomic" ? `write ${s.path}` : `${s.op} ${s.path}`;
    byPath.set(k, (byPath.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byPath) console.log(`   ${n}x ${k}`);
  if (steps.length === 0) {
    console.log("CONVERGED");
    process.exit(0);
  }
  // apply steps virtually
  const files = new Set(state.files);
  const texts = new Map(state.texts);
  for (const s of steps) {
    if (s.op === "write-atomic") {
      files.add(s.path);
      texts.set(s.path, s.content);
    } else if (s.op === "trash") {
      files.delete(s.path);
      texts.delete(s.path);
    }
  }
  state = { files: [...files], texts };
}
console.log("DID NOT CONVERGE");
process.exit(2);
