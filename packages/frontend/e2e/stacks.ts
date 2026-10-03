// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { delimiter, join } from "node:path";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";

/** One API + one Vite on their own ports and workspace, owned by one Playwright worker. */
export interface Stack {
	index: number;
	workspaceDir: string;
	frontendPort: string;
	apiPort: string;
	frontendURL: string;
}

export function stackFor(
	root: string,
	index: number,
	frontendBase: number,
	apiBase: number,
): Stack {
	// Interleaved (3000/3001, 3002/3003, ...) so the defaults never collide.
	const frontendPort = String(frontendBase + index * 2);
	return {
		index,
		workspaceDir: join(root, `stack-${index}`),
		frontendPort,
		apiPort: String(apiBase + index * 2),
		frontendURL: `http://localhost:${frontendPort}`,
	};
}

/** Playwright's own reading of `--workers`/`-j`, so there is one stack per worker. */
export function workerCount(argv: string[], ci: boolean): number {
	const cpus = availableParallelism();
	let raw = process.env.PRISMALENS_E2E_WORKERS;
	argv.forEach((arg, i) => {
		const m = arg.match(/^(?:--workers|-j)(?:=(.+)|(\d.*))?$/);
		if (m) raw = m[1] ?? m[2] ?? argv[i + 1];
	});
	if (raw?.endsWith("%"))
		return Math.max(1, Math.floor((cpus * Number.parseInt(raw, 10)) / 100));
	const n = Number.parseInt(raw ?? "", 10);
	if (Number.isInteger(n) && n > 0) return n;
	return ci ? cpus : Math.min(4, cpus);
}

/**
 * A PATH of node, pnpm, git and the OS base directories, so installed agents
 * never answer the harness gate. Wrappers, not directories: an nvm bin holds
 * `npm i -g` agents too. Opt-out and story: e2e/README.md, "Agents on PATH".
 */
export function agentFreePath(toolsDir: string): string {
	mkdirSync(toolsDir, { recursive: true });
	const inherited = process.env.PATH ?? "";
	for (const tool of ["node", "pnpm", "git"]) {
		const target =
			tool === "node" ? process.execPath : resolveOnPath(tool, inherited);
		if (!target) throw new Error(`e2e needs ${tool} on PATH`);
		const shim = join(toolsDir, tool);
		writeFileSync(shim, `#!/bin/sh\nexec "${target}" "$@"\n`);
		chmodSync(shim, 0o755);
		writeFileSync(`${shim}.cmd`, `@"${target}" %*\r\n`);
	}
	const system =
		process.platform === "win32"
			? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
			: ["/usr/bin", "/bin"];
	const path = [toolsDir, ...system].join(delimiter);
	const leaked = Object.values(HARNESS_REGISTRY)
		.flatMap((h) => [h.binary, h.companionBinary])
		.filter((bin): bin is string => !!bin && !!resolveOnPath(bin, path));
	if (leaked.length > 0) {
		throw new Error(
			`${leaked.join(", ")} found in ${system.join(", ")}; set PRISMALENS_E2E_KEEP_PATH=1 to run with your own PATH`,
		);
	}
	return path;
}
