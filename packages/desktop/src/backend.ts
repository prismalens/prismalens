// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The backend child: spawn, wait for `/health`, stop. The launcher owns the
 * child's lifetime; a backend it attached to is left alone on quit.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type BackendSpawn, backendUrl } from "./supervisor.js";

/** Where the packed `prismalens` package lives: beside the app in production, or wherever the env points in development. */
export function resolveBackendMain(input: {
	resourcesPath: string;
	env: NodeJS.ProcessEnv;
}): string {
	const dir =
		input.env.PRISMALENS_DESKTOP_BACKEND ??
		join(input.resourcesPath, "prismalens");
	const main = input.env.PRISMALENS_DESKTOP_BACKEND
		? join(dir, "dist", "bin", "prismalens.js")
		: join(
				dir,
				"lib",
				"node_modules",
				"prismalens",
				"dist",
				"bin",
				"prismalens.js",
			);
	if (!existsSync(main)) {
		throw new Error(
			`No packed prismalens at ${dir}. Run \`pnpm --filter @prismalens/desktop stage:backend\`, or set PRISMALENS_DESKTOP_BACKEND to a packed package.`,
		);
	}
	return main;
}

export function startBackend(plan: BackendSpawn): ChildProcess {
	return spawn(plan.command, plan.args, {
		env: plan.env,
		stdio: ["ignore", "ignore", "pipe"],
		windowsHide: true,
	});
}

export async function waitForHealth(
	port: number,
	timeoutMs: number,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const url = `${backendUrl(port)}/health`;
	while (Date.now() < deadline) {
		// A stalled request must not outlive the deadline, nor eat the whole of it.
		const remaining = Math.max(1, deadline - Date.now());
		try {
			const res = await fetchImpl(url, {
				signal: AbortSignal.timeout(Math.min(remaining, 2_000)),
			});
			if (res.ok) return true;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
}

export function stopBackend(child: ChildProcess): void {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
	child.once("exit", () => clearTimeout(timer));
}
