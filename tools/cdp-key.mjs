// SPDX-License-Identifier: LicenseRef-Proprietary
// Dispatches native keyboard events via CDP
const port = process.env.CDP_PORT ?? "9223";
const key = process.argv[2] ?? "p";
const ctrl = process.argv[3] === "ctrl";
const shift = process.argv[3] === "shift";

const list = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const i = ++id;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === i) resolve(m);
    };
    ws.send(JSON.stringify({ id: i, method, params }));
  });

let modifiers = 0;
if (ctrl) modifiers |= 2;
if (shift) modifiers |= 8;

const code = `Key${key.toUpperCase()}`;
const vk = key.toUpperCase().charCodeAt(0);

await send("Input.dispatchKeyEvent", {
  type: "rawKeyDown",
  modifiers,
  windowsVirtualKeyCode: vk,
  code,
  key,
});

await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  modifiers,
  windowsVirtualKeyCode: vk,
  code,
  key,
});

ws.close();
console.log(`Dispatched key: ${key} (ctrl=${ctrl}, shift=${shift})`);
