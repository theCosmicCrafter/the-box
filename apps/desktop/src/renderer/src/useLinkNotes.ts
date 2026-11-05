// SPDX-License-Identifier: LicenseRef-Proprietary
// useLinkNotes.ts - the "arrows are notes" kernel (ADR-0003, R-B):
// edge create/delete/retarget, link-note load/save, endpoint-authority
// sync, and the ADR-0010 proposal layer. Extracted from App.tsx; board
// mutations still flow through box-core WritePlans + saveBoard, and the
// note is written before/with the board so reconcile never sees drift.

import type {
    CanvasEdge,
    CanvasNode,
    IDecisionClient,
    LinkNote,
    LinkTypeProposal,
    ProblemItem,
    Side,
} from "@box/core";
import {
    createDecisionClient,
    createEdgePlan,
    deleteEdgePlan,
    linkNoteName,
    parseLinkNote,
    serializeLinkNote,
} from "@box/core";
import { useBoxStore } from "@box/ui";
import { useRef, useState } from "react";
import { applyPlan } from "./bridge.js";

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

export function useLinkNotes(deps: {
  workspaceRoot: string | null;
  boardPath: string | null;
  saveBoard: () => Promise<void>;
  rescan: () => Promise<void>;
  captureUndo: () => void;
}) {
  const { workspaceRoot, boardPath, saveBoard, rescan, captureUndo } = deps;
  // The selected edge's link note, parsed from disk.
  const [edgeNote, setEdgeNote] = useState<LinkNote | null>(null);
  // ADR-0010: Stage-4 proposal layer - ephemeral React state, never
  // persisted; the only write it can cause is the user-confirmed action.
  const [linkProposal, setLinkProposal] =
    useState<LinkTypeProposal | null>(null);
  const dismissedProposals = useRef(new Set<string>());
  const decisionClient = useRef<IDecisionClient>(createDecisionClient());
  const noteDirty = useRef(false);
  const [noteStale, setNoteStale] = useState(false);

  const nodeSummary = (id: string): string => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === id);
    if (n === undefined) return id;
    if (typeof n.label === "string" && n.label !== "") return n.label;
    if (n.type === "file" && typeof n.file === "string")
      return n.file.split("/").pop() ?? n.file;
    if (n.type === "text" && typeof n.text === "string")
      return n.text.slice(0, 80);
    return n.type;
  };

  // FR-401 / ADR-0010: after an edge lands, ask the local decision
  // client for a link type. Offline/disabled resolves null - the pill
  // never mounts, nothing else changes.
  const proposeLinkType = async (edge: CanvasEdge) => {
    if (dismissedProposals.current.has(edge.id)) return;
    const p = await decisionClient.current.suggestLinkType(
      edge.id,
      nodeSummary(edge.fromNode),
      nodeSummary(edge.toNode),
    );
    // Re-check at apply time (ADR-0010 §5): the edge may be gone or the
    // user may have acted while the answer was in flight.
    if (p === null || dismissedProposals.current.has(p.edgeId)) return;
    const alive = useBoxStore
      .getState()
      .board?.edges.some((x) => x.id === p.edgeId);
    if (alive === true) setLinkProposal(p);
  };

  const confirmLinkProposal = async () => {
    const p = linkProposal;
    if (p === null || !workspaceRoot || !window.box) return;
    const b = useBoxStore.getState().board;
    const e = b?.edges.find((x) => x.id === p.edgeId);
    if (e === undefined) {
      setLinkProposal(null);
      return;
    }
    const rel = e["box-link"];
    const text = await window.box.readFile(workspaceRoot, rel);
    setLinkProposal(null);
    if (text === null || text === undefined) return;
    const { value } = parseLinkNote(text, rel);
    if (!value) return;
    const fm = { ...value.frontmatter, type: p.suggestedType };
    await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeLinkNote({ ...value, frontmatter: fm }),
    );
    // R-B: the note is endpoint/label-authoritative; rescan propagates
    // type -> board label denorm (FR-204 path).
    void rescan();
    if (edgeNote?.path === rel) void selectEdge(p.edgeId);
  };

  const dismissLinkProposal = () => {
    if (linkProposal !== null)
      dismissedProposals.current.add(linkProposal.edgeId);
    setLinkProposal(null);
  };

  // I-2: edge erase -> tombstone, board, note to Recycle Bin.
  const deleteEdge = async (edgeId: string) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const errors = await applyPlan(
      workspaceRoot,
      deleteEdgePlan(b, boardPath, edgeId),
    );
    if (errors.length === 0) {
      useBoxStore.getState().removeEdge(edgeId);
      setEdgeNote(null);
      setLinkProposal((p) => (p?.edgeId === edgeId ? null : p));
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Edge selected -> load its link note (the meaning half of the wedge).
  const selectEdge = async (edgeId: string | null) => {
    if (edgeId === null || !workspaceRoot || !window.box) {
      setEdgeNote(null);
      noteDirty.current = false;
      setNoteStale(false);
      return;
    }
    const edge = useBoxStore
      .getState()
      .board?.edges.find((e) => e.id === edgeId);
    const rel =
      (edge?.["box-link"] as string | undefined) ?? linkNoteName(edgeId);
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) {
      setEdgeNote(null);
      useBoxStore.getState().setProblems([`link note missing on disk: ${rel}`]);
      return;
    }
    const { value, problems } = parseLinkNote(text, rel);
    if (value) {
      setEdgeNote(value);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      setEdgeNote(null);
      useBoxStore.getState().setProblems(problems.map(fmtProblem));
    }
  };

  // Re-route: an edge endpoint dropped on a new node keeps the edge id and
  // the link note - only from/to + the *-file denorms change (the note IS
  // the relationship, so retargeting edits it in place, not delete+create).
  // Rewrite a link note's endpoint denorms to match the board edge. The
  // note is endpoint-authoritative on reconcile (R-B: note wins), so any
  // board-side endpoint change must write the note too or the next sync
  // silently reverts it.
  const syncEdgeNote = async (
    edgeId: string,
    b: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  ) => {
    const e = b.edges.find((x) => x.id === edgeId);
    if (e === undefined || workspaceRoot === null || !window.box) return;
    const rel = e["box-link"];
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) return;
    const { value } = parseLinkNote(text, rel);
    if (!value) return;
    const fm = { ...value.frontmatter };
    fm.from = e.fromNode;
    fm.to = e.toNode;
    const fileOf = (id: string) => {
      const n = b.nodes.find((x) => x.id === id);
      return n?.type === "file" ? n.file : undefined;
    };
    const ff = fileOf(e.fromNode);
    const tf = fileOf(e.toNode);
    if (ff !== undefined) fm["from-file"] = ff;
    else delete fm["from-file"];
    if (tf !== undefined) fm["to-file"] = tf;
    else delete fm["to-file"];
    await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeLinkNote({ ...value, frontmatter: fm }),
    );
  };

  const retargetEdge = async (
    edgeId: string,
    end: "from" | "to",
    nodeId: string,
    side: Side,
  ) => {
    const b = useBoxStore.getState().board;
    const e = b?.edges.find((x) => x.id === edgeId);
    const n = b?.nodes.find((x) => x.id === nodeId);
    if (!b || !e || !n || !workspaceRoot || !window.box) return;
    captureUndo();
    useBoxStore
      .getState()
      .updateEdge(
        edgeId,
        end === "to"
          ? { toNode: nodeId, toSide: side }
          : { fromNode: nodeId, fromSide: side },
      );
    const after = useBoxStore.getState().board;
    if (after !== null) await syncEdgeNote(edgeId, after);
    await saveBoard();
    // If the open note panel shows this edge, refresh it.
    if (edgeNote?.path === e["box-link"]) void selectEdge(edgeId);
  };

  const saveNote = async (next: LinkNote) => {
    if (!workspaceRoot || !window.box) return;
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      next.path,
      serializeLinkNote(next),
    );
    if (r.ok) {
      setEdgeNote(next);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      useBoxStore.getState().setProblems([`note save failed: ${r.error}`]);
    }
  };

  // ADR-0007 v1: restore a captured snapshot through the normal board
  // write path - undo never invents a second persistence channel. Edges
  // whose endpoints differ between snapshots have their link notes
  // rewritten too (R-B: the note is endpoint-authoritative, so a
  // board-only restore would be reverted by the next reconcile).
  const healChangedEdgeNotes = async (
    before: CanvasEdge[],
    after: CanvasEdge[],
    restored: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  ) => {
    const preMap = new Map(before.map((e) => [e.id, e]));
    for (const e of after) {
      const pre = preMap.get(e.id);
      if (
        pre !== undefined &&
        (pre.fromNode !== e.fromNode || pre.toNode !== e.toNode)
      )
        await syncEdgeNote(e.id, restored);
    }
  };

  // ADR-0013: Edge visual styling & Canvas high-res export
  const handleUpdateEdge = async (updates: Partial<CanvasEdge>) => {
    const b = useBoxStore.getState().board;
    if (!b || !edgeNote) return;
    const eid = edgeNote.frontmatter["box-edge"];
    useBoxStore.getState().updateEdge(eid, updates);
    await saveBoard();
  };

  // I-1: edge draw -> link note written first, board second.
  const createEdge = async (
    fromId: string,
    toId: string,
    fromSide: Side,
    toSide: Side,
  ) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const { plan, edge } = createEdgePlan(b, boardPath, fromId, toId, {
      fromSide,
      toSide,
    });
    const errors = await applyPlan(workspaceRoot, plan);
    if (errors.length === 0) {
      useBoxStore.getState().addEdge(edge);
      void rescan(); // the new link-<id>.md should appear in the file list
      void proposeLinkType(edge);
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  return {
    edgeNote,
    setEdgeNote,
    linkProposal,
    noteStale,
    setNoteStale,
    noteDirty,
    decisionClient,
    selectEdge,
    deleteEdge,
    retargetEdge,
    saveNote,
    createEdge,
    healChangedEdgeNotes,
    handleUpdateEdge,
    confirmLinkProposal,
    dismissLinkProposal,
  };
}
