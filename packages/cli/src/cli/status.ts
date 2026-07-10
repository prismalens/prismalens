// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineCommand } from "citty";
import { createSessionManager, type SessionStatus } from "../core/session.js";
import consola from "consola";

export default defineCommand({
	meta: {
		name: "status",
		description: "List incident groups and runs with their state (running, done, errored)",
	},
	args: {
		status: {
			type: "string",
			description: "Filter by status (running, done, errored)",
			required: false,
		},
		"base-dir": {
			type: "string",
			description: "Workspace base directory (default: ~/.prismalens)",
			required: false,
		},
	},
	async run({ args }) {
		const sessions = createSessionManager(args["base-dir"]);
		
		let filter: { status?: SessionStatus[] } | undefined = undefined;
		if (args.status) {
			const statusParts = args.status.split(",");
			filter = { status: statusParts as SessionStatus[] };
		}
		
		try {
			const runs = await sessions.list(filter);
			if (runs.length === 0) {
				consola.info("No runs found.");
				return;
			}
			
			for (const run of runs) {
				const info = [
					`run_id: ${run.runId}`,
					`status: ${run.status}`,
					`created_at: ${run.createdAt}`,
				];
				if (run.alertname) info.push(`alertname: ${run.alertname}`);
				if (run.agent) info.push(`agent: ${run.agent}`);
				if (run.repo) info.push(`repo: ${run.repo}`);
				
				consola.log(info.join(" | "));
			}
		} catch (err) {
			consola.error("Failed to read status:", err);
			process.exit(1);
		}
	}
});
