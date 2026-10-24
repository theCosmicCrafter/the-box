// SPDX-License-Identifier: LicenseRef-Proprietary
// CDP eval helper: node tools/cdp-eval.mjs '<expr>' [port]
import { readFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9223";
let expr = process.argv.slice(2).join(" ");
if (process.argv[2] === "-" || !expr) {
  expr = readFileSync(0, "utf8");
}
const list = await fetch(`http://localhost:${port}/json/list`).then((r) =>
  r.json(),
);
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0;
const pend = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) pend[m.id](m);
};
await new Promise((r) => (ws.onopen = r));
const res = await new Promise((r) => {
  const i = ++id;
  pend[i] = r;
  ws.send(
    JSON.stringify({
      id: i,
      method: "Runtime.evaluate",
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }),
  );
});
const v = res.result?.result?.value ?? res.result ?? res;
console.log(JSON.stringify(v));
ws.close();
