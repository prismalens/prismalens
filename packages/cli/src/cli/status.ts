// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineCommand } from "citty";
import consola from "consola";
import { createSessionManager, type SessionStatus } from "../core/session.js";

export default defineCommand({
	meta: {
		name: "status",
		description:
			"List incident groups and runs with their state (running, done, errored)",
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

		const valid: SessionStatus[] = ["running", "done", "errored"];
		let filter: { status?: SessionStatus[] } | undefined;
		if (args.status) {
			const parts = args.status
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			const bad = parts.filter((s) => !valid.includes(s as SessionStatus));
			if (bad.length > 0) {
				consola.error(
					`Invalid status: ${bad.join(", ")}. Valid: ${valid.join(", ")}`,
				);
				process.exit(1);
			}
			filter = { status: parts as SessionStatus[] };
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
	},
});
