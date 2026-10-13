# M-1 — Media serving on a file-first canvas (verified patterns)

|              |                                                                             |
| ------------ | --------------------------------------------------------------------------- |
| **Method**   | Source inspection: `obsidian.asar` (v1.14.4 shipped binary), tldraw clone,  |
|              | AnimRef clone, Eagle/eagle-mcp layout docs, Heptabase asar (T-8)            |
| **Verified** | 2026-10-13                                                                  |
| **Status**   | Complete — implemented in `apps/desktop/src/main/index.ts` + `NodeView.tsx` |

## The verified pattern: custom scheme + streaming + mtime cache-bust

Obsidian serves vault media through `app://` — the exact shape `box://`
follows. Read directly from `obsidian.asar/main.js` (v1.14.4):

```ts
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      corsEnabled: true,
    },
  },
]);
```

And `getResourcePath` (`obsidian.asar/app.js` @553196) builds URLs as:

```
app://<resourcePathPrefix>/<file-URL-path>?<mtime>
```

The **`?<mtime>` query is the cache buster** — an external edit bumps mtime,
the URL changes, and Chromium re-fetches instead of serving a stale cache
entry. The handler then streams `fs.createReadStream` and answers
**`Range:` requests with 206 + Content-Range/Content-Length/Accept-Ranges** —
required for `<video>`/`<audio>` seeking. A `noframe` flag on external
paths adds `X-Frame-Options: DENY`.

## What we adopted

- `box://f/<rel>?v=<mtime>` — mtime cache-bust (renderer reads mtime from the
  workspace file list the watcher already maintains).
- Range → 206 streaming via `fs.createReadStream` (video/audio seek).
- Same privilege set incl. `codeCache`/`corsEnabled`; `Access-Control-Allow-Origin`
  on responses (our dev page is `http://localhost`, prod is `file://` — both
  are cross-origin to `box:`, unlike Obsidian whose page _is_ `app://`).
- `resolveInside` containment = their `resolve(join(root,rel)).startsWith(root)`
  guard.
- `<video muted loop autoplay playsInline>` per tldraw `VideoShapeUtil`
  (`autoplay: true` default) and AnimRef — clips read at a glance, silently.
- Audio = controls only when selected (Heptabase `audioCard` precedent —
  ambient boards stay quiet). PDF = badge only until pdfjs-wasm is worth
  bundling (Heptabase/Obsidian both ship it).
- Renderer CSP must whitelist the scheme (`img-src/media-src/connect-src`)
  — the template's `default-src 'self'` blocked `box:` entirely.

## Rejected for now

- **Eagle's thumbnail-file-per-item** (`library/images/<id>.info/`) — real
  thumbnail cache on disk. Overkill at our scale: DOM `<img>` handles
  hundreds of nodes fine. Escalation path if needed: `.box/cache/`.
- **tldraw `downsizeImage`** (canvas re-encode at ≤2× display size) — only
  earns its keep if nodes render full-res multi-MP rasters at tiny sizes.
- **Excalidraw/PureRef embedded blobs** — violates our files-are-truth rule.

## Other verified details worth remembering

- Obsidian stubs **all** `intercept*Protocol` on default session to a
  `() => false` noop — belt-and-braces lockdown.
- Obsidian permission-gates paths outside the vault (`lo()`/`so()` pair)
  — the precedent for a future "open external file with consent" feature.
