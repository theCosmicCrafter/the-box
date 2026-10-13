// CDP eval helper: node tools/cdp-eval.mjs '<expr>' [port]
const port = process.argv[3] ?? "9223";
const expr = process.argv[2];
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
