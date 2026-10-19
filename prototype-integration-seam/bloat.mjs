// PROTOTYPE, throwaway. Bytes of tool schemas the harness would load: full GitHub MCP vs allowlisted.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "b", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://api.githubcopilot.com/mcp/"), { requestInit: { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` } } }));
const { tools } = await c.listTools();
const ro = tools.filter((t) => t.annotations?.readOnlyHint);
console.log(`github default toolset: ${tools.length} tools, ${JSON.stringify(tools).length} bytes; readOnlyHint=true: ${ro.length}; writes: ${tools.filter((t)=>!t.annotations?.readOnlyHint).map(t=>t.name).slice(0,8).join(",")}...`);
const c2 = new Client({ name: "b", version: "0" });
await c2.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:7810/mcp"), { requestInit: { headers: { Authorization: `Bearer ${process.env.RUN_TOKEN}` } } }));
const g = (await c2.listTools()).tools; console.log(`gateway (3 sources, allowlisted): ${g.length} tools, ${JSON.stringify(g).length} bytes`);
process.exit(0);
