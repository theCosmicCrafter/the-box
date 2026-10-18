// Local stub for the Von `/v1/systemone` decision endpoint (ADR-0010
// live verify while the real daemon is offline). Returns a canned
// link-type answer so the FR-401 pill path is exercised end-to-end.
// Sends permissive CORS headers because the WebView2 fetch origin is
// box://localhost (cross-origin to 127.0.0.1) - real daemons must do
// the same or calls route through Rust.
// Usage: node tools/stub-von.mjs [port]
import http from "node:http";

const port = Number(process.argv[2] ?? 8771);
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const state = parsed.state ?? {};
        console.log(
          `[stub-von] questions=${Object.keys(parsed.questions ?? {}).join(",")} from=${state.from} to=${state.to}`,
        );
      } catch {
        console.log("[stub-von] unparseable body");
      }
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(
        JSON.stringify({
          answers: { link_type: { pick: "supports", confidence: 0.91 } },
        }),
      );
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`stub-von on :${port}`));
