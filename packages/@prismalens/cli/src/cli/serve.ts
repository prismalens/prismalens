// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens serve` — run the JSON-RPC 2.0 server over stdio (ADR-0007/0010).
 *
 * This is the LIVE channel (replacing file-read): the desktop app / API spawn
 * `prismalens serve`, call `initialize` + `investigate`, and consume
 * `investigate/event` notifications as the Tier-1 supervisor streams. The
 * ~/.prismalens workspace stays the durable record (events.jsonl + report.json),
 * written exactly as the `investigate` command writes it.
 */
import { defineCommand } from "citty";
import { runJsonRpcServer } from "../jsonrpc/server.js";

/** Reported as serverInfo.version by `initialize` (matches the CLI's meta.version). */
const SERVER_VERSION = "0.0.1";

export default defineCommand({
	meta: {
		name: "serve",
		description:
			"Run the JSON-RPC 2.0 server over stdio (the LIVE channel for the desktop app / API).",
	},
	async run() {
		await runJsonRpcServer({ version: SERVER_VERSION });
	},
});
