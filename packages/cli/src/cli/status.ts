// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineCommand } from "citty";
import consola from "consola";
import { createSessionManager, type SessionStatus } from "../core/session.js";

export default defineCommand({
	meta: {
		name: "status",
		description:
			"List incident groups and runs with their state (running, done, errored, suppressed)",
	},
	args: {
		status: {
			type: "string",
			description: "Filter by status (running, done, errored, suppressed)",
			required: false,
		},
		"base-dir": {
			type: "string",
			description: "Workspace base directory (default: ~/.prismalens)",
			required: false,
		},
	},
	async run({ args, cmd }) {
		let sessions: ReturnType<typeof createSessionManager> | undefined;
		try {
			for (const key of Object.keys(args)) {
				if (key !== "_" && !(cmd?.args as Record<string, unknown>)?.[key]) {
					consola.error(`Unknown option: --${key}`);
					process.exit(1);
				}
			}
			sessions = createSessionManager(args["base-dir"]);

			const valid: SessionStatus[] = [
				"running",
				"done",
				"errored",
				"suppressed",
			];
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
					// exitCode (not process.exit) so the finally block still closes the
					// session manager before the process tears down.
					process.exitCode = 1;
					return;
				}
				filter = { status: parts as SessionStatus[] };
			}

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
				if (run.status === "suppressed" && run.suppressionReason) {
					info.push(`suppressed_by: ${run.suppressionReason}`);
				}

				consola.log(info.join(" | "));
			}
		} catch (err) {
			consola.error("Failed to read status:", err);
			process.exitCode = 1;
		} finally {
			sessions?.close?.();
		}
	},
});
