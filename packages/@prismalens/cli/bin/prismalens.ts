#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens` / `pl` — the engine CLI (ADR-0010: the engine is a CLI; the desktop
 * app + API drive it). Command bodies live in ../src/cli/* and are loaded lazily so
 * a fast `--help` doesn't pull in the engine. Bodies are implemented separately.
 */
import { type CommandDef, defineCommand, runMain } from "citty";

// The AI SDK's one-time "AI SDK Warning System" banner prints via console.info
// (STDOUT) mid-run — noise in the live timeline and corruption in piped JSON.
// Off for the whole CLI; real per-warning notices still reach stderr via
// process.emitWarning.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/** Lazily import a command body's default export from src/cli. */
const lazy = (name: string) => (): Promise<CommandDef> =>
	import(`../src/cli/${name}.js`).then((m) => m.default as CommandDef);

const main = defineCommand({
	meta: {
		name: "prismalens",
		version: "0.0.1",
		description:
			"PrismaLens investigation engine CLI — drives the two-tier engine (ADR-0008/0010).",
	},
	subCommands: {
		investigate: lazy("investigate"),
		serve: lazy("serve"),
		doctor: lazy("doctor"),
		init: lazy("init"),
	},
});

runMain(main);
