#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { generate, loadConfig } from "./gen/index.ts";

/** `registry [--config <file>] gen [--check]`. */
function main(argv: string[]): number {
	const args = [...argv];
	const at = args.indexOf("--config");
	const config = at >= 0 ? args.splice(at, 2)[1] : "registry.config.json";
	if (!config) return usage();
	const [cmd, ...rest] = args;
	const cfg = loadConfig(config);
	if (cmd === "gen") {
		const check = rest.includes("--check");
		const { problems, stale } = generate(cfg, check);
		for (const p of problems) console.error(p);
		for (const f of stale)
			console.error(`${f} is stale. Run \`pnpm registry gen\` and commit it.`);
		if (problems.length || stale.length) return 1;
		console.log(check ? "registry: fresh" : "registry: generated");
		return 0;
	}
	return usage();
}

function usage(): number {
	console.error("usage: registry [--config <file>] gen [--check]");
	return 2;
}

process.exitCode = main(process.argv.slice(2));
