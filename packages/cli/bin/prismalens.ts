#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens` / `pl` — the engine CLI (ADR-0010: the engine is a CLI; the desktop
 * app + API drive it). Command bodies live in ../src/cli/* and are loaded lazily so
 * a fast `--help` doesn't pull in the engine. Bodies are implemented separately.
 */
import { type CommandDef, defineCommand, runMain } from "citty";
import { cliVersion } from "../src/version.js";

// The AI SDK's one-time "AI SDK Warning System" banner prints via console.info
// (STDOUT) mid-run — noise in the live timeline and corruption in piped JSON.
// Off for the whole CLI; real per-warning notices still reach stderr via
// process.emitWarning.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const originalWarningListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning: Error) => {
	if (
		warning.name === "ExperimentalWarning" &&
		warning.message.includes("SQLite")
	)
		return;
	for (const listener of originalWarningListeners) {
		listener(warning);
	}
});

/** Lazily import a command body's default export from src/cli. */
const lazy = (name: string) => (): Promise<CommandDef> =>
	import(`../src/cli/${name}.js`).then((m) => m.default as CommandDef);

const main = defineCommand({
	meta: {
		name: "prismalens",
		version: cliVersion(),
		description:
			"PrismaLens investigation engine CLI — drives the two-tier engine (ADR-0008/0010).",
	},
	subCommands: {
		investigate: lazy("investigate"),
		listen: lazy("listen"),
		serve: lazy("serve"),
		doctor: lazy("doctor"),
		init: lazy("init"),
		status: lazy("status"),
		report: lazy("report"),
	},
});

runMain(main);
