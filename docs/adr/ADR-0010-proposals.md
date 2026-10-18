# ADR-0010 - Stage 4 proposal surface and lifecycle

- **Status:** Accepted
- **Date:** 2026-10-18
- **Relates:** PRD FR-401..407, ERR-9, I-9 (AI never mutates placed objects),
  ADR-0001 D-8 (Jev-compatible Von client, already settled),
  ADR-0007 (oplog is the audit trail)

## Context

Stage 4 adds optional local intelligence on top of deterministic behavior.
The Von decision client (`decisions.ts`) already exists, is disabled by
default, and is total (every failure resolves `{ ok:false, offline:true }`).
What was undecided is the contract for where a proposal may live, how it is
confirmed, and what - if anything - it may write.

## Decision

1. **Proposals are ephemeral.** A proposal exists only in renderer memory
   (React state). It is never written to a board, a note, `.box/` app state,
   or any file. A proposal can cause exactly one kind of disk write: the
   user-confirmed action, which travels the normal WritePlan / note-write
   channel and therefore lands in the oplog as an ordinary user edit (the
   oplog stays the single audit trail - unaccepted suggestions are noise,
   not truth).

2. **Dismissal is session-scoped.** Dismissed entity ids live in an
   in-memory set for the session. There is no persisted "do not suggest
   again" - a suggestion that matters enough to remember permanently is a
   user preference, which belongs in settings, not proposal state.

3. **Enable path.** `settings.json` gains `ai?: { enabled?: boolean;
vonUrl?: string }` under the existing unknown-key-preserving merge.
   Default off. When enabled, the client is constructed once per app
   session; unreachable endpoints resolve offline and every Stage 4
   surface simply renders nothing (FR-407, ERR-9: features hide, no error
   UI, no spinner, core unaffected).

4. **FR-401 surface (link-type suggestion).** When an edge draw completes,
   the app fires `suggestLinkType` with from/to summaries (node label or
   file basename or text snippet). A proposal renders as a small pill at
   the edge midpoint - `{suggested type}?` with confirm and dismiss
   glyphs. Confirm writes `type:` into the link note's frontmatter through
   the existing note-edit path (parse, set key, serialize,
   `writeFileAtomic`, rescan), which propagates to the board `label`
   denorm by the established R-B reconciliation. Dismiss or a new action
   on the edge drops the proposal. The pill never intercepts edge
   selection and never auto-applies.

5. **Validity at apply time.** Proposals carry the entity id they were
   issued for; confirm re-checks the edge still exists before writing. A
   proposal for a deleted edge, or a stale answer arriving after
   superseding input, drops silently.

6. **Transport is Rust IPC, not webview fetch.** The webview CSP
   (`connect-src 'self' box: ipc: ...`) deliberately blocks all outbound
   http - a plain `fetch` to `127.0.0.1:8770` fails before a byte leaves
   the page. Decision calls therefore travel `invoke -> Rust -> ureq ->
loopback`. The Rust command (`decide_post`) accepts the JSON body as a
   string, enforces a **loopback-only allowlist**
   (`http://127.0.0.1:*`, `http://localhost:*`, `http://[::1]:*`), and
   returns the response body; the renderer wraps it in a `Response` and
   injects it as the client's `fetchFn` (the seam `decisions.ts` was
   built for). CSP stays tight, the zero-cloud rule is enforced in
   platform code, and offline resolves through the same `{ok:false,
offline:true}` path.

7. **Scope.** This ADR settles the proposal lifecycle and the FR-401
   surface. FR-402..406 each get their own ADR when implemented (FR-405
   needs an embedding-index decision - `.box/` app-state, rebuildable,
   served by a local model such as Ollama `bge-m3`; FR-406 `box-mcp` is a
   separate process).

## Consequences

- I-9 is enforced structurally: the proposal layer holds no write path of
  its own, so there is nothing to accidentally bypass.
- No new file formats. The only persisted surface is the user-confirmed
  edit, indistinguishable from a manual one.
- Offline behavior is identical for a missing daemon and a missing
  feature flag: silence.
