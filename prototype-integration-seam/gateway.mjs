// PROTOTYPE, throwaway. One MCP doorway per run: sources as data, deny-by-default allowlist,
// credentials held here and never returned, audit log. Sources: builtin Prometheus, GitHub remote MCP, git CLI.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const RUN_TOKEN = process.env.RUN_TOKEN;            // minted per run, handed to the harness via ACP headers
const SECRETS = [process.env.GH_TOKEN].filter(Boolean);
const AUDIT = process.env.AUDIT_LOG ?? "gateway-audit.log";
const audit = (o) => appendFileSync(AUDIT, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
const redact = (s) => SECRETS.reduce((a, k) => a.split(k).join("[redacted]"), s);
const cap = (s, n = 6000) => (s.length > n ? s.slice(0, n) + `\n[truncated ${s.length - n} bytes]` : s);

// Sources are data (would live in Integration/Connection rows).
const SOURCES = [
  { id: "prom", kind: "builtin", category: "metrics", url: process.env.PROM_URL ?? "https://prometheus.demo.prometheus.io",
    hint: "PromQL. Instant query only in this prototype." },
  { id: "github", kind: "mcp-upstream", category: "scm", url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "X-MCP-Readonly": "true" },
    allow: ["get_file_contents", "list_commits", "get_commit", "search_repositories", "list_releases", "get_latest_release", "list_tags", "search_code"] },
  { id: "git", kind: "cli", category: "scm", bin: "git", cwd: process.env.GIT_CWD ?? process.cwd(),
    verbs: ["log", "show", "diff", "rev-parse", "blame", "ls-files"], denyArgs: [/^--output/, /^--ext-diff/, /^-c$/, /^--exec/, /^--upload-pack/, /^-o$/] },
  { id: "datadog", kind: "mcp-upstream", category: "logs", status: "not-configured" },
];
const state = new Map(); // id -> { status, tools, client, offered }

async function probe(src) {
  if (src.status === "not-configured") return state.set(src.id, { status: "not-configured", tools: [] });
  try {
    if (src.kind === "builtin") {
      const r = await fetch(`${src.url}/api/v1/query?query=1`); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      state.set(src.id, { status: "connected", tools: [{ name: "prom_query", description: `Run an instant PromQL query on ${src.id}. ${src.hint}`,
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] });
    } else if (src.kind === "mcp-upstream") {
      const client = new Client({ name: "pl-gateway", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(src.url), { requestInit: { headers: src.headers } }));
      const { tools } = await client.listTools();
      const kept = tools.filter((t) => src.allow.includes(t.name)); // deny by default; readOnlyHint is advisory only
      state.set(src.id, { status: "connected", client, offered: tools.length,
        tools: kept.map((t) => ({ ...t, name: `${src.id}_${t.name}`, upstream: t.name })) });
    } else if (src.kind === "cli") {
      state.set(src.id, { status: "connected", tools: [{ name: "git_run", description: `Run a read-only git command in the bound repo. Allowed verbs: ${src.verbs.join(", ")}.`,
        inputSchema: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"] } }] });
    }
  } catch (e) { state.set(src.id, { status: "unreachable", error: redact(String(e.message)), tools: [] }); }
}

const sourcesList = () => SOURCES.map((s) => { const st = state.get(s.id) ?? {};
  return { id: s.id, kind: s.kind, category: s.category, status: st.status, tools: (st.tools ?? []).map((t) => t.name),
    ...(st.offered ? { upstreamToolsOffered: st.offered, exposedAfterAllowlist: st.tools.length } : {}),
    ...(st.status === "not-configured" ? { howToConnect: "pl connect logs datadog", alternatives: ["prom"] } : {}) }; });

function allTools() {
  return [{ name: "sources_list", description: "List every data source this run can reach, its status, and its tools. Call first.",
    inputSchema: { type: "object", properties: {} } }, ...[...state.values()].flatMap((s) => s.tools.map(({ upstream, ...t }) => t))];
}
const text = (s, isError = false) => ({ content: [{ type: "text", text: cap(redact(s)) }], isError });

async function call(name, args) {
  if (name === "sources_list") return text(JSON.stringify(sourcesList(), null, 1));
  if (name === "prom_query") {
    const src = SOURCES[0]; const r = await fetch(`${src.url}/api/v1/query?query=${encodeURIComponent(args.query)}`);
    return text(await r.text(), !r.ok);
  }
  if (name === "git_run") {
    const src = SOURCES.find((s) => s.id === "git"); const a = args.args ?? [];
    if (!src.verbs.includes(a[0])) return text(`denied: verb '${a[0]}' not in read-only allowlist ${src.verbs.join(",")}`, true);
    if (a.some((x) => src.denyArgs.some((re) => re.test(x)))) return text("denied: argument not allowed", true);
    return new Promise((res) => execFile(src.bin, ["--no-pager", ...a], { cwd: src.cwd, maxBuffer: 1 << 20, timeout: 15000 },
      (err, out, errOut) => res(text(out || errOut || String(err), Boolean(err)))));
  }
  for (const [id, st] of state) {
    const t = st.tools.find((x) => x.name === name);
    if (t && st.client) { const r = await st.client.callTool({ name: t.upstream, arguments: args });
      return { ...r, content: r.content.map((c) => (c.type === "text" ? { ...c, text: cap(redact(c.text)) } : c)) }; }
  }
  const known = SOURCES.find((s) => name.startsWith(`${s.id}_`));
  if (known && state.get(known.id)?.status === "connected") return text(`denied: '${name}' is not on ${known.id}'s read-only allowlist`, true);
  if (known) return text(JSON.stringify({ status: state.get(known.id)?.status ?? "not-configured", source: known.id, alternatives: ["prom"], howToConnect: `pl connect ${known.category} ${known.id}` }));
  return text(`denied: tool '${name}' is not exposed by the gateway`, true);
}

function mcp() {
  const s = new Server({ name: "prismalens-gateway", version: "0.0.1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools() }));
  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t0 = Date.now(); const { name, arguments: args = {} } = req.params;
    let r; try { r = await call(name, args); } catch (e) { r = text(`error: ${e.message}`, true); }
    audit({ tool: name, args, ms: Date.now() - t0, isError: Boolean(r.isError), bytes: JSON.stringify(r).length });
    return r;
  });
  return s;
}

await Promise.all(SOURCES.map(probe));
audit({ startup: sourcesList() });
const port = Number(process.env.PORT ?? 7810);
createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${RUN_TOKEN}`) { audit({ rejected: req.url }); res.writeHead(401).end(); return; }
  let body = ""; for await (const c of req) body += c;
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp().connect(t); await t.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}).listen(port, "127.0.0.1", () => console.error(`gateway on ${port}: ${JSON.stringify(sourcesList().map((s) => [s.id, s.status, s.tools.length]))}`));
