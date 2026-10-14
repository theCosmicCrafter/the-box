// SPDX-License-Identifier: LicenseRef-Proprietary
// Perf probe: measures scan time, board parse, render mount, and pan frame
// timing on the live app via CDP. Usage: node tools/perf-probe.mjs [port]
const port = process.argv[2] ?? "9223";

async function eval_(expr) {
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
  ws.close();
  const v = res.result?.result?.value ?? res.result;
  if (res.result?.exceptionDetails)
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  return v;
}

// In-page probes against the store (store is exposed on window for dev tools
// in this codebase - check `window.__box` / store module). Fall back to DOM
// metrics if the store isn't reachable.
const report = await eval_(`(async () => {
  const t0 = performance.now();
  const out = {};
  const nodes = document.querySelectorAll('.node');
  const hidden = document.querySelectorAll('.node[style*="display: none"], .node[style*="display:none"]');
  out.domNodes = nodes.length;
  out.culledNodes = hidden.length;
  out.edges = document.querySelectorAll('.edge-layer path, svg path.edge').length;

  // Pan frame timing: dispatch synthetic wheel pans and measure rAF deltas.
  const frames = [];
  const vp = document.querySelector('.canvas-viewport') || document.querySelector('[class*="viewport"]');
  if (vp) {
    for (let k = 0; k < 3; k++) await new Promise(r => requestAnimationFrame(r));
    // Self-re-arming rAF chain captures every frame while pans dispatch.
    let last = performance.now();
    let run = true;
    const loop = () => {
      const n = performance.now();
      frames.push(n - last);
      last = n;
      if (run) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const stop = performance.now() + 1500;
    while (performance.now() < stop) {
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true }));
      await new Promise(r => setTimeout(r, 16));
    }
    run = false;
    await new Promise(r => setTimeout(r, 60));
    frames.sort((a, b) => a - b);
    out.panFrames = {
      n: frames.length,
      median: frames[Math.floor(frames.length / 2)]?.toFixed(2),
      p95: frames[Math.floor(frames.length * 0.95)]?.toFixed(2),
      max: frames[frames.length - 1]?.toFixed(2),
      fpsMedian: frames.length ? (1000 / frames[Math.floor(frames.length / 2)]).toFixed(1) : null,
    };
  }
  out.probeMs = (performance.now() - t0).toFixed(0);
  return out;
})()`);

console.log(JSON.stringify(report, null, 2));
