// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A marker for the isolation rows (#1180): `node marker.mjs <dir> <name>` writes <dir>/<name> and
// exits, as a hook; with a third argument `mcp` it then serves MCP on stdio with one tool, named by
// an optional fourth (`marker` by default), and writes <dir>/<name>.called at each call of it.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [dir, name, mode, tool = "marker"] = process.argv.slice(2);
appendFileSync(
	join(dir, name),
	`${new Date().toISOString()} pid=${process.pid} ppid=${process.ppid}\n`,
);
if (mode !== "mcp") process.exit(0);
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
	let m;
	try {
		m = JSON.parse(line);
	} catch {
		return;
	}
	if (m.id === undefined) return;
	if (m.method === "initialize")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: {
				protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name, version: "0.0.1" },
			},
		});
	else if (m.method === "tools/list")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: {
				tools: [
					{
						name: tool,
						description: name,
						inputSchema: { type: "object", properties: {} },
					},
				],
			},
		});
	else if (m.method === "tools/call") {
		appendFileSync(
			join(dir, `${name}.called`),
			`${new Date().toISOString()}\n`,
		);
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: { content: [{ type: "text", text: `${name} marker called` }] },
		});
	} else send({ jsonrpc: "2.0", id: m.id, result: {} });
});
process.stdin.on("end", () => process.exit(0));
