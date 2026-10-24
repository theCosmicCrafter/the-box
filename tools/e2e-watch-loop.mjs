// SPDX-License-Identifier: LicenseRef-Proprietary
// E2E: the watcher's reconcile path on a real fixture workspace.
// Simulates what main does per pass - scan, parse, reconcile, exec -
// then deletes the link note "externally" and proves I-3 (edge removed,
// not regenerated) because knownNotes remembered it.
// Usage: node tools/e2e-watch-loop.mjs <workspace-dir>

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  edgeIdFromNoteName,
  parseBoard,
  parseLinkNote,
  reconcile,
} from "../packages/box-core/dist/index.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: node tools/e2e-watch-loop.mjs <workspace-dir>");
  process.exit(1);
}

function listFiles(dir, rel = "", out = []) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (p !== ".box/tmp") listFiles(dir, p, out);
    } else out.push(p);
  }
  return out;
}

function buildScan(root, files, knownNotes) {
  const boards = new Map();
  const notes = new Map();
  for (const p of files) {
    if (p.endsWith(".box.canvas"))
      boards.set(p, parseBoard(readFileSync(join(root, p), "utf8"), p));
    else if (!p.includes("/") && edgeIdFromNoteName(p) !== null)
      notes.set(p, parseLinkNote(readFileSync(join(root, p), "utf8"), p));
  }
  const tombstones = new Set(
    JSON.parse(readFileSync(join(root, ".box/tombstones.json"), "utf8")),
  );
  return { boards, notes, files: new Set(files), tombstones, knownNotes };
}

// pass 1: initial state - fixture has one edge backed by one note
let files = listFiles(root);
let knownNotes = new Set(
  files.map((f) => edgeIdFromNoteName(f)).filter((id) => id !== null),
);
let scan = buildScan(root, files, knownNotes);
let report = reconcile(scan);
console.log(
  "pass 1: steps=%d problems=%d broken=%d",
  report.plan.steps.length,
  report.problems.length,
  report.brokenEdges.length,
);
if (report.plan.steps.length !== 0)
  throw new Error("fixture should reconcile clean");

// external delete: user deletes link-<id>.md in Explorer
const note = files.find((f) => edgeIdFromNoteName(f) !== null);
rmSync(join(root, note));
console.log("external delete:", note);

// pass 2: watcher fires -> knownNotes still holds the id -> I-3 removes edge
files = listFiles(root);
scan = buildScan(root, files, knownNotes);
report = reconcile(scan);
console.log(
  "pass 2: steps=%d problems=%s",
  report.plan.steps.length,
  JSON.stringify(report.problems.map((p) => p.kind)),
);
const boardWrite = report.plan.steps.find(
  (s) => s.op === "write-atomic" && s.path.endsWith(".box.canvas"),
);
if (!boardWrite) throw new Error("I-3 expected a board rewrite, got none");
const fixed = parseBoard(boardWrite.content).value;
console.log("edges after I-3:", fixed.edges.length);
if (fixed.edges.length !== 0) throw new Error("edge should be gone");
if (report.plan.steps.some((s) => "path" in s && s.path === note))
  throw new Error("note must NOT be regenerated (deleted, not never-seen)");

// execute it for real, then re-verify convergence
writeFileSync(join(root, boardWrite.path), boardWrite.content);
files = listFiles(root);
scan = buildScan(root, files, knownNotes);
report = reconcile(scan);
console.log("converged:", report.plan.steps.length === 0);
console.log("E2E I-3 OK");
