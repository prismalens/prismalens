// PROTOTYPE, throwaway. Drives one ACP harness with mcpServers = [probe] and reports whether the tool was called.
// usage: node acp-probe.mjs <claude|codex> <stdio|http> [prompt]
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

const [harness, transport, promptArg] = process.argv.slice(2);
const nonce = `n${Math.random().toString(36).slice(2, 10)}`;
const LOG = resolve(`probe-calls-${harness}-${transport}.log`);
const ADAPTERS = {
  claude: { js: "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    env: { CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_BIN, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    meta: { claudeCode: { options: { settingSources: ["user"] } } } },
  codex: { js: "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    env: { CODEX_PATH: process.env.CODEX_BIN }, meta: undefined },
};
const a = ADAPTERS[harness];
const env = { ...process.env, ...Object.fromEntries(Object.entries(a.env).filter(([, v]) => v)) };
const child = spawn(process.execPath, [resolve(a.js)], { env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });

const updates = [];
const conn = new acp.ClientSideConnection(() => ({
  async requestPermission(p) {
    updates.push({ permission: p.toolCall?.title });
    const opt = p.options.find((o) => o.kind === "allow_once") ?? p.options[0];
    return { outcome: { outcome: "selected", optionId: opt.optionId } };
  },
  async sessionUpdate(n) {
    const u = n.update;
    if (u.sessionUpdate === "tool_call") updates.push({ tool_call: u.title, kind: u.kind, status: u.status });
    if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") updates.push({ text: u.content.text });
  },
  async readTextFile() { return { content: "" }; }, async writeTextFile() { return {}; },
}), acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));

const mcpServers = transport === "http"
  ? [{ type: "http", name: "pl-probe", url: process.env.PROBE_URL ?? "http://127.0.0.1:7801/mcp",
       headers: [{ name: "Authorization", value: "Bearer run-token-123" }] }]
  : [{ name: "pl-probe", command: process.execPath, args: [resolve("probe-server.mjs")],
       env: [{ name: "PROBE_NONCE", value: nonce }, { name: "PROBE_LOG", value: LOG }] }];

const t0 = Date.now();
const kill = setTimeout(() => { console.log(JSON.stringify({ harness, transport, error: "timeout", stderr: stderr.slice(-800), updates })); child.kill(); process.exit(2); }, 240000);
try {
  const init = await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  const sess = await conn.newSession({ cwd: process.cwd(), mcpServers, ...(a.meta ? { _meta: a.meta } : {}) });
  if (process.env.MODE) { const o = (sess.configOptions ?? []).find((c) => c.category === "mode" || c.id === "mode");
    const r = o ? await conn.setSessionConfigOption({ sessionId: sess.sessionId, configId: o.id, value: process.env.MODE }) : await conn.setSessionMode({ sessionId: sess.sessionId, modeId: process.env.MODE });
    updates.push({ text: `[mode set to ${process.env.MODE} via ${o ? "config option" : "set_mode"}]
` }); }
  const prompt = promptArg ?? "Use the pl_probe tool from the pl-probe MCP server (pass who=your harness name) and reply with exactly the PROBE_NONCE value it returns. Do not use any other tool.";
  const res = await conn.prompt({ sessionId: sess.sessionId, prompt: [{ type: "text", text: prompt }] });
  const text = updates.filter((u) => u.text).map((u) => u.text).join("");
  const log = existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").slice(-3) : [];
  console.log(JSON.stringify({ harness, transport, agent: init.agentInfo, mcpCapabilities: init.agentCapabilities?.mcpCapabilities,
    stopReason: res.stopReason, secs: Math.round((Date.now() - t0) / 1000),
    toolCalls: updates.filter((u) => u.tool_call || u.permission), reply: text.slice(-300),
    nonceExpected: transport === "http" ? "(server env)" : nonce, serverLog: log }, null, 1));
} catch (e) {
  console.log(JSON.stringify({ harness, transport, error: String(e?.message ?? e), detail: e?.data, stderr: stderr.slice(-800) }));
}
clearTimeout(kill); child.kill(); process.exit(0);
