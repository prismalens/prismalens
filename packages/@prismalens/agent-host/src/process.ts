// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChildProcessByStdio, SpawnOptions } from "node:child_process";
import { spawnSync } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import crossSpawn from "cross-spawn";
import which from "which";
import type { LaunchCommand, LaunchPlan } from "./launch.js";
import {
	AGENT_REGISTRY,
	type AgentDescriptor,
	type AgentId,
} from "./registry/index.js";

export type AgentChild = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Kills `pid`'s whole tree: a POSIX agent leads its own process group, and on
 * Windows taskkill /T reaches the agent behind a `.cmd` shim. False when nothing was signalled.
 */
export function killProcessTree(
	child: { pid?: number; kill(signal?: NodeJS.Signals): boolean },
	signal: NodeJS.Signals = "SIGTERM",
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (child.pid !== undefined) {
		if (platform === "win32") {
			const res = spawnSync(
				"taskkill",
				["/pid", String(child.pid), "/T", "/F"],
				{
					windowsHide: true,
				},
			);
			if (!res.error && res.status === 0) return true;
		} else {
			try {
				process.kill(-child.pid, signal);
				return true;
			} catch {
				// ESRCH or EPERM: fall back to the child alone.
			}
		}
	}
	return child.kill(signal);
}

/** Starts the plan's agent with exactly the plan's env; cross-spawn runs a Windows `.cmd` shim without `shell: true`. */
export function spawnAgent(
	plan: Pick<LaunchPlan, "command" | "args" | "cwd" | "env">,
): AgentChild {
	const options: SpawnOptions = {
		cwd: plan.cwd,
		env: plan.env,
		stdio: ["pipe", "pipe", "pipe"],
		detached: process.platform !== "win32",
		windowsHide: true,
	};
	return crossSpawn(plan.command, plan.args, options) as AgentChild;
}

export interface DetectOptions {
	/** PATH to search; the host's by default. */
	pathEnv?: string;
	/** The adapter script a product ships for `pkg`, or null (#818). */
	shippedAdapter?: (pkg: string) => string | null;
}

function onPath(bin: string, pathEnv: string | undefined): string | null {
	if (!bin) return null;
	return which.sync(bin, {
		nothrow: true,
		...(pathEnv !== undefined ? { path: pathEnv } : {}),
	});
}

/**
 * How a row starts: its binary on PATH wins; else the product's shipped adapter,
 * once the agent's own CLI is on PATH. Null: not installed.
 */
export function detectAgent(
	agent: AgentId,
	opts: DetectOptions = {},
	row: AgentDescriptor = AGENT_REGISTRY[agent],
): LaunchCommand | null {
	const companion = row.companionBinary
		? onPath(row.companionBinary, opts.pathEnv)
		: null;
	const withCompanion = companion ? { companionPath: companion } : {};
	const found = onPath(row.binary, opts.pathEnv);
	if (found) return { command: found, args: [], ...withCompanion };
	if (!row.adapterPackage || !companion) return null;
	const script = opts.shippedAdapter?.(row.adapterPackage);
	if (!script) return null;
	return {
		command: process.execPath,
		args: [script],
		// An Electron host's child must run as Node too.
		env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
		shipped: true,
		...withCompanion,
	};
}
