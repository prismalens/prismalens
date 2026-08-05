// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The {@link JobRunner} that actually runs an investigation: fork one child per run and
 * speak the `@prismalens/worker` IPC protocol to it.
 *
 * The fork is crash and memory isolation of the Tier-1 loop from the API process. It is
 * NOT credential isolation — that design is gone (credentials are fetched per-run and
 * held in memory, and nothing assigns `process.env`). Worker threads would not do: they
 * share the heap and the crash domain, which is the whole point of the fork.
 */

import { type ChildProcess, fork } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ChildMessage, HostMessage } from "@prismalens/worker/protocol";
import type { JobRunner, RunningJob, RunOutcome } from "./dispatcher.js";
import type { ClaimedJob } from "./job-store.js";

const require = createRequire(import.meta.url);

/** Grace period between asking a child to stop and killing it. */
const CANCEL_GRACE_MS = 15_000;

export interface ForkRunnerOptions {
	/** Explicit entrypoint. Empty/absent resolves `@prismalens/worker`. */
	entry?: string;
	/** Extra env for the child, merged over `process.env`. */
	env?: NodeJS.ProcessEnv;
	log?: { warn(message: string): void; error(message: string): void };
}

/**
 * Locate the per-run child entrypoint.
 *
 * Prefers the built `dist/index.js`. Falls back to the TypeScript source when the package
 * has not been built — a dev-loop convenience, and the reason the fork carries a `tsx`
 * loader in that case.
 */
export function resolveChildEntry(explicit?: string): {
	entry: string;
	needsTsLoader: boolean;
} {
	if (explicit) {
		return { entry: explicit, needsTsLoader: explicit.endsWith(".ts") };
	}
	try {
		return {
			entry: require.resolve("@prismalens/worker"),
			needsTsLoader: false,
		};
	} catch {
		const pkgDir = dirname(require.resolve("@prismalens/worker/package.json"));
		const source = join(pkgDir, "src", "index.ts");
		if (!existsSync(source)) {
			throw new Error(
				`Cannot locate the investigation child entrypoint. Build @prismalens/worker, or set PRISMALENS_WORKER_ENTRY.`,
			);
		}
		return { entry: source, needsTsLoader: true };
	}
}

export function createForkRunner(options: ForkRunnerOptions = {}): JobRunner {
	const { entry, needsTsLoader } = resolveChildEntry(options.entry);

	return (job: ClaimedJob, sink): RunningJob => {
		const child: ChildProcess = fork(entry, [], {
			stdio: ["ignore", "inherit", "inherit", "ipc"],
			env: { ...process.env, ...options.env },
			...(needsTsLoader ? { execArgv: ["--import", "tsx"] } : {}),
		});

		let settled = false;
		let cancelRequested = false;
		let reported: RunOutcome | null = null;
		let killTimer: NodeJS.Timeout | null = null;

		const done = new Promise<RunOutcome>((resolve) => {
			const finish = (outcome: RunOutcome) => {
				if (settled) return;
				settled = true;
				if (killTimer) clearTimeout(killTimer);
				resolve(outcome);
			};

			child.on("message", (message: ChildMessage) => {
				switch (message.type) {
					case "event":
						sink.onEvent(message.event);
						break;
					case "progress":
						sink.onProgress(message.percent, message.message);
						break;
					case "stream-done":
						sink.onStreamDone();
						break;
					case "result":
						// Hold the verdict rather than resolving now: the child still has to
						// exit, and its exit is what proves the sandbox teardown finished.
						reported = {
							outcome: message.outcome,
							retryable: message.retryable,
							...(message.error ? { error: message.error } : {}),
						};
						break;
				}
			});

			child.on("error", (error) => {
				options.log?.error(
					`Investigation child for job ${job.id} errored: ${error.message}`,
				);
				finish({
					outcome: "failed",
					retryable: true,
					error: error.message,
				});
			});

			child.on("exit", (code, signal) => {
				// Close the relay even on a crash, so no SSE client waits forever on a
				// stream whose producer is gone.
				sink.onStreamDone();

				if (reported) {
					finish(reported);
					return;
				}
				if (cancelRequested) {
					finish({ outcome: "cancelled", retryable: false });
					return;
				}
				// Died without reporting: a crash, an OOM kill, or a hard shutdown. This is
				// precisely the fault a rerun exists for.
				finish({
					outcome: "failed",
					retryable: true,
					error: `Investigation child exited without a result (code=${code}, signal=${signal})`,
				});
			});
		});

		const start: HostMessage = {
			type: "start",
			jobId: job.id,
			// `attempts` was already incremented by the claim, so this run is attempt N and
			// there are N-1 completed attempts behind it. The child clears the previous
			// attempt's durable events when that is non-zero.
			attempt: Math.max(0, job.attempts - 1),
			data: JSON.parse(job.payload),
		};
		child.send(start);

		return {
			done,
			cancel: () => {
				if (settled || cancelRequested) return;
				cancelRequested = true;
				child.send({ type: "cancel" } satisfies HostMessage);
				// A harness parked in a syscall may never observe the abort. Give the
				// cooperative path a grace window, then stop asking.
				killTimer = setTimeout(() => {
					if (!settled) child.kill("SIGKILL");
				}, CANCEL_GRACE_MS);
				killTimer.unref?.();
			},
			kill: () => {
				if (settled) return;
				child.kill("SIGKILL");
			},
		};
	};
}
