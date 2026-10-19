// PROTOTYPE, throwaway. One-tool MCP server; logs every call so the server side proves the harness called it.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { z } from "zod";

const LOG = process.env.PROBE_LOG ?? "probe-calls.log";
const NONCE = process.env.PROBE_NONCE ?? "nonce-missing";
function build(transport) {
  const s = new McpServer({ name: "pl-probe", version: "0.0.1" });
  s.tool("pl_probe", "Returns the prismalens probe nonce. Call it when asked for the probe nonce.",
    { who: z.string().optional() },
    async ({ who }) => {
      appendFileSync(LOG, `${new Date().toISOString()} ${transport} called by=${who ?? "?"} nonce=${NONCE}\n`);
      return { content: [{ type: "text", text: `PROBE_NONCE=${NONCE} via ${transport}` }] };
    });
  return s;
}
if (process.argv[2] === "http") {
  const port = Number(process.argv[3] ?? 7801);
  createServer(async (req, res) => {
    const auth = req.headers.authorization ?? "";
    appendFileSync(LOG, `${new Date().toISOString()} http ${req.method} auth=${auth ? "present" : "none"}\n`);
    let body = ""; for await (const c of req) body += c;
    if (body) appendFileSync(LOG, `${new Date().toISOString()} http rpc ${JSON.parse(body).method}
`);
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await build("http").connect(t);
    await t.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  }).listen(port, "127.0.0.1", () => console.error(`probe http on ${port}`));
} else {
  const t = new StdioServerTransport(); await build("stdio").connect(t);
  appendFileSync(LOG, `${new Date().toISOString()} stdio server started pid=${process.pid}
`);
  const om = t.onmessage; t.onmessage = (m) => { appendFileSync(LOG, `${new Date().toISOString()} stdio rpc ${m.method ?? "response"}
`); om(m); };
}
