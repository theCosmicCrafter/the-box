// Capture console/exception output for N ms (optionally reload first).
// node tools/cdp-console.mjs [ms] [--reload]
const port = process.env.CDP_PORT ?? "9223";
const ms = Number(process.argv[2] ?? 4000);
const reload = process.argv.includes("--reload");
const list = await fetch(`http://localhost:${port}/json/list`).then((r) =>
  r.json(),
);
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0;
const pend = {};
const out = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) pend[m.id](m);
  if (m.method === "Runtime.consoleAPICalled")
    out.push(
      m.params.type +
        ": " +
        m.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    );
  if (m.method === "Runtime.exceptionThrown")
    out.push(
      "EXC: " +
        (m.params.exceptionDetails.exception?.description ??
          m.params.exceptionDetails.text),
    );
  if (m.method === "Log.entryAdded")
    out.push("log:" + m.params.entry.level + " " + m.params.entry.text);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pend[i] = r;
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Runtime.enable");
await send("Log.enable");
if (reload) await send("Page.enable").then(() => send("Page.reload"));
await new Promise((r) => setTimeout(r, ms));
console.log(out.slice(0, 40).join("\n") || "(quiet)");
ws.close();
