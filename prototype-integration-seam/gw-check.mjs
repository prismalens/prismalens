// PROTOTYPE, throwaway. Direct checks against the gateway without a harness.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "check", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:7810/mcp"), { requestInit: { headers: { Authorization: `Bearer ${process.env.RUN_TOKEN}` } } }));
const { tools } = await c.listTools(); console.log("tools:", tools.map((t) => t.name).join(", "));
for (const [n, a] of [["git_run", { args: ["push", "origin", "HEAD"] }], ["git_run", { args: ["-c", "core.pager=x", "log"] }],
  ["github_create_issue", { owner: "x", repo: "y", title: "z" }], ["datadog_search_logs", { q: "x" }], ["git_run", { args: ["log", "-1", "--oneline"] }]]) {
  const r = await c.callTool({ name: n, arguments: a }); console.log(`${n} ${JSON.stringify(a)} -> isError=${Boolean(r.isError)} ${r.content[0].text.slice(0, 160).replace(/\n/g, " ")}`);
}
process.exit(0);
