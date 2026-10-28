// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Launches the harness child through `@prismalens/agent-host` (#916): the env is the
 * launch plan's, the spawn `spawnAgent`'s, the kill `killProcessTree`'s. This file adds
 * the run's wall clock and the reaping of every live harness on the way out.
 */
import {
	type AgentChild,
	killProcessTree,
	spawnAgent,
} from "@prismalens/agent-host";
import type {
	HarnessChild,
	HarnessLauncher,
	LaunchOptions,
	RunLimits,
} from "./types.js";

const TREE_KILL_WRAPPED = Symbol.for("prismalens.treeKillWrapped");

/** `child.kill` kills the whole tree, keeping the object and its ChildProcess contract. */
export function wrapWithTreeKill<
	T extends {
		pid?: number;
		kill(signal?: NodeJS.Signals): boolean;
		killed?: boolean;
	},
>(child: T, platform: NodeJS.Platform = process.platform): T {
	if ((child as Record<symbol, unknown>)[TREE_KILL_WRAPPED]) return child;
	const rawKill = child.kill.bind(child);
	child.kill = (signal?: NodeJS.Signals): boolean => {
		const sent = killProcessTree(
			{ pid: child.pid, kill: rawKill },
			signal ?? "SIGTERM",
			platform,
		);
		if (sent) child.killed = true;
		return sent;
	};
	(child as Record<symbol, unknown>)[TREE_KILL_WRAPPED] = true;
	return child;
}

/**
 * Arms a SIGKILL timer for `limits.wallClockMs`, cleared when the child closes on
 * its own; when it fires it flips `timedOut` so the runner reports a deadline kill,
 * not an early exit.
 */
export function withWallClock(
	child: AgentChild,
	limits: RunLimits | undefined,
): HarnessChild {
	wrapWithTreeKill(child);
	const proc = child as AgentChild & {
		timedOut: boolean;
	};
	proc.timedOut = false;
	if (limits?.wallClockMs && limits.wallClockMs > 0) {
		const timer = setTimeout(() => {
			proc.timedOut = true;
			proc.kill("SIGKILL");
		}, limits.wallClockMs);
		timer.unref(); // a pending deadline must not keep the event loop alive
		child.on("close", () => clearTimeout(timer));
	}
	return proc;
}

/**
 * Every harness any launcher still has running. A POSIX harness leads its own
 * process group, so a terminal Ctrl-C no longer reaches it: the API has to reap
 * it on the way out.
 */
const liveHarnesses = new Set<HarnessChild>();
let exitReapArmed = false;

/** Kills every live harness's process tree. Synchronous, so it is safe in an `exit` listener. */
export function reapLiveHarnesses(): void {
	for (const child of liveHarnesses) {
		// `killed` only says a signal was sent; a harness that ignored SIGTERM still runs.
		child.kill("SIGKILL");
	}
	liveHarnesses.clear();
}

/** Spawns the harness as a child of the API. One per run; `destroy()` reaps stragglers. */
export function createProcessLauncher(): HarnessLauncher {
	if (!exitReapArmed) {
		exitReapArmed = true;
		process.once("exit", reapLiveHarnesses);
	}
	const children = new Set<HarnessChild>();
	return {
		spawn(command, args, options: LaunchOptions): HarnessChild {
			const child = spawnAgent({
				command,
				args,
				cwd: options.cwd,
				env: options.env,
			});
			const proc = withWallClock(child, options.limits);
			children.add(proc);
			liveHarnesses.add(proc);
			proc.on("close", () => {
				children.delete(proc);
				liveHarnesses.delete(proc);
			});
			return proc;
		},
		async destroy(): Promise<void> {
			for (const child of children) {
				if (!child.killed) child.kill();
			}
			children.clear();
		},
	};
}
