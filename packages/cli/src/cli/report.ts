// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineCommand } from "citty";
import consola from "consola";
import { createSessionManager } from "../core/session.js";
import { assertKnownFlags } from "./flags.js";

export default defineCommand({
	meta: {
		name: "report",
		description: "Print a stored report for a given run ID",
	},
	args: {
		id: {
			type: "positional",
			description: "The run ID",
			required: true,
		},
		events: {
			type: "boolean",
			description: "Include timeline events",
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
			assertKnownFlags(args, cmd);
			sessions = createSessionManager(args["base-dir"]);

			const report = await sessions.readReport(args.id);
			if (!report) {
				consola.error(`No report for run ${args.id}`);
				// exitCode (not process.exit) so the finally block still closes the
				// session manager before the process tears down.
				process.exitCode = 1;
				return;
			}

			consola.log(JSON.stringify(report, null, 2));

			if (args.events) {
				const events = await sessions.readEvents(args.id);
				consola.log("\n--- Timeline Events ---");
				for (const ev of events) {
					consola.log(JSON.stringify(ev));
				}
			}
		} catch (err) {
			consola.error("Failed to read report:", err);
			process.exitCode = 1;
		} finally {
			sessions?.close?.();
		}
	},
});
