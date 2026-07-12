// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineCommand } from "citty";
import consola from "consola";
import { createSessionManager, type SessionStatus } from "../core/session.js";
import { assertKnownFlags } from "./flags.js";

export default defineCommand({
	meta: {
		name: "status",
		description:
			"List incident groups and runs with their state (running, done, errored, suppressed)\n\nExamples:\n  $ pl status\n  $ pl status --status running,errored\n  $ pl status --json",
	},
	args: {
		status: {
			type: "string",
			description: "Filter by status (running, done, errored, suppressed)",
			required: false,
		},
		"base-dir": {
			type: "string",
			description:
				"Workspace directory (default: ~/.prismalens; overridden by PRISMALENS_USER_FOLDER)",
			required: false,
		},
		json: {
			type: "boolean",
			description: "Print machine-readable JSON",
			required: false,
		},
	},
	async run({ args, cmd }) {
		let sessions: ReturnType<typeof createSessionManager> | undefined;
		try {
			assertKnownFlags(args, cmd);
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

			const json = Boolean(args.json);

			const runs = await sessions.list(filter);

			if (json) {
				process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
				return;
			}

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
