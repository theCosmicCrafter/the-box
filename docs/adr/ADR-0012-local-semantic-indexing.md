# ADR-0012 - Local semantic indexing (.box/embeddings.json) and note similarity

- **Status:** Accepted
- **Date:** 2026-10-23
- **Relates:** PRD §1, FR-401, Stage 4 Local Intelligence, Invariant I-9, Zero-cloud constraint, AGENTS.md machine rules

## Context

The Box users work with visual thinking surfaces containing dozens to hundreds of
markdown notes, document excerpts, concepts, and link notes. As workspaces grow,
discovering relevant notes across distant canvas clusters becomes essential.

However, The Box adheres to three strict architectural constraints:
1. **Zero-Cloud / Local Truth:** No vault data, file contents, or embeddings may ever
   be transmitted to external cloud APIs. All intelligence must run strictly on local
   loopback daemons (Ollama `:11434`, Von `:8770`).
2. **Files Are Truth / Derived Caches:** Any index, vector store, or embedding cache
   is strictly derived state and may be deleted at any time without data loss. The
   workspace must function completely without it.
3. **Invariant I-9 (User Placement Invariant):** "Placement is only ever written by
   explicit user action - no code path may move a placed object automatically." AI
   or semantic similarity must never rearrange or move placed nodes automatically.
   It may only recommend or highlight connections upon explicit user action.

## Decision

1. **Loopback Embedding Client:**
   Semantic embedding generation runs exclusively against local loopback HTTP:
   - Primary: Ollama loopback (`http://127.0.0.1:11434/api/embeddings`) utilizing the
     workstation's locally installed embedding model (such as `bge-m3:latest`).
   - Offline fallback: If the local Ollama daemon is unreachable or offline, the app
     falls back to a deterministic local character/token frequency vectorizer. No
     unhandled exceptions or error banners are produced when offline.

2. **Derived Cache Contract (`.box/embeddings.json`):**
   The application persists computed embeddings in a disposable JSON cache at
   `.box/embeddings.json`:
   ```json
   {
     "v": 1,
     "model": "bge-m3:latest",
     "entries": {
       "notes/idea.md": {
         "mtime": 1729680000000,
         "embedding": [0.0123, -0.0456, ...]
       }
     }
   }
   ```
   Deleting `.box/embeddings.json` is completely safe; missing entries are lazily
   recomputed on demand when the user invokes similarity features.

3. **Core vs Platform Decoupling:**
   Per `docs/ARCHITECTURE.md`, `@box/core` remains platform-agnostic and free of
   network dependencies.
   - `@box/core` provides pure mathematical and indexing functions: vector cosine
     similarity, top-K ranking, normalization, and cache data-structure serialization.
   - The desktop layer (`apps/desktop`) handles loopback HTTP communication with
     `127.0.0.1:11434` and file persistence through the existing atomic file bridge.

4. **Explicit User-Invoked Affordances:**
   Semantic features are triggered only by explicit user action:
   - "Find related notes" in the node context menu.
   - Canvas Search & Filter bar semantic / text query matching.
   - When matches are found, related nodes are highlighted or listed with similarity
     scores; the user can jump to them or create an edge with a single click. No
     positions are mutated automatically.

## Consequences

- Workspace files remain 100% private and offline.
- Semantic suggestions operate at sub-second local latency.
- The system adheres strictly to Invariant I-9 and the derived-cache contract.
