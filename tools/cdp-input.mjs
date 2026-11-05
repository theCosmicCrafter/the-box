// SPDX-License-Identifier: LicenseRef-Proprietary
// CDP real-input driver: node tools/cdp-input.mjs '<json-script>'
// Script = [{x,y,type:"move"|"down"|"up"|"click",button?}] dispatched through
// Input.dispatchMouseEvent - real pointer pipeline (setPointerCapture works).
import { readFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9223";
const raw = process.argv[2] === "-" || !process.argv[2]
  ? readFileSync(0, "utf8")
  : process.argv[2];
const steps = JSON.parse(raw);
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
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id;
    pend[i] = r;
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const buttonMask = { left: 1, right: 2, middle: 4 };
for (const s of steps) {
  const b = s.button ?? "left";
  await send("Input.dispatchMouseEvent", {
    type:
      s.type === "down"
        ? "mousePressed"
        : s.type === "up"
          ? "mouseReleased"
          : s.type === "click"
            ? "mousePressed"
            : "mouseMoved",
    x: s.x,
    y: s.y,
    button: b,
    buttons:
      s.type === "move"
        ? (s.buttons ?? buttonMask[b] ?? 1)
        : s.type === "up"
          ? 0
          : (s.buttons ?? buttonMask[b] ?? 1),
    clickCount: s.count ?? 1,
    pointerType: "mouse",
  });
  if (s.type === "click") {
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: s.x,
      y: s.y,
      button: s.button ?? "left",
      buttons: 0,
      clickCount: s.count ?? 1,
      pointerType: "mouse",
    });
  }
  await new Promise((r) => setTimeout(r, s.wait ?? 30));
}
console.log("done", steps.length);
ws.close();
