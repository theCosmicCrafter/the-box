// SPDX-License-Identifier: LicenseRef-Proprietary
// Captures a full-window screenshot of The Box via CDP
import { writeFileSync } from "node:fs";

const outPath = process.argv[2];
const port = process.env.CDP_PORT ?? "9223";

if (!outPath) {
  console.error("Usage: node tools/cdp-screenshot.mjs <out-path>");
  process.exit(1);
}

const list = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0;
const pend = {};

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) pend[m.id](m);
};

await new Promise((r) => (ws.onopen = r));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pend[i] = resolve;
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const res = await send("Page.captureScreenshot", { format: "png" });
if (res.result?.data) {
  writeFileSync(outPath, Buffer.from(res.result.data, "base64"));
  console.log(`Screenshot saved to ${outPath}`);
} else {
  console.error("Failed to capture screenshot:", res);
}

ws.close();
