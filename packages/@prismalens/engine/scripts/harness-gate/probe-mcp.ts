// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "prismalens-probe", version: "0.0.1" });
server.registerTool(
	"prismalens_probe",
	{ description: "Returns the probe token." },
	async () => {
		writeFileSync(
			join(process.env.PROBE_MARKERS ?? ".", "injected-mcp-called"),
			"",
		);
		return {
			content: [
				{ type: "text", text: `PROBE TOKEN: ${process.env.PROBE_TOKEN}` },
			],
		};
	},
);
await server.connect(new StdioServerTransport());
