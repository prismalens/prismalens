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
import type {
	ChildMessage,
	HostMessage,
	StartMessage,
} from "@prismalens/worker/protocol";
import type { JobRunner, RunningJob, RunOutcome } from "./dispatcher.js";
import type { ClaimedJob } from "./job-store.js";

const require = createRequire(import.meta.url);

/** Grace period between asking a child to stop and killing it. */
const CANCEL_GRACE_MS = 15_000;

/** How long a child may take to exit AFTER reporting its terminal result. */
const EXIT_GRACE_MS = 30_000;

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
		// Parse BEFORE forking. A malformed payload is a permanent fault, and throwing
		// after the fork would leak a child the dispatcher never learns about.
		let payload: unknown;
		try {
			payload = JSON.parse(job.payload);
		} catch (error) {
			throw new Error(
				`Job ${job.id} has an unparseable payload: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		const child: ChildProcess = fork(entry, [], {
			stdio: ["ignore", "inherit", "inherit", "ipc"],
			env: { ...process.env, ...options.env },
			...(needsTsLoader ? { execArgv: ["--import", "tsx"] } : {}),
		});

		let settled = false;
		let cancelRequested = false;
		let reported: RunOutcome | null = null;
		let killTimer: NodeJS.Timeout | null = null;
		let exitTimer: NodeJS.Timeout | null = null;

		const done = new Promise<RunOutcome>((resolve) => {
			const finish = (outcome: RunOutcome) => {
				if (settled) return;
				settled = true;
				if (killTimer) clearTimeout(killTimer);
				if (exitTimer) clearTimeout(exitTimer);
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
						// But do not wait forever for it. A child that reported and then
						// failed to exit — a leaked handle, a wedged teardown — would
						// otherwise hold its claim alive indefinitely, heartbeating a job
						// that is already decided. Bound the wait, then stop asking.
						if (!exitTimer) {
							exitTimer = setTimeout(() => {
								if (settled) return;
								options.log?.warn(
									`Investigation child for job ${job.id} reported its result but did not exit; killing it`,
								);
								child.kill("SIGKILL");
							}, EXIT_GRACE_MS);
							exitTimer.unref?.();
						}
						break;
				}
			});

			child.on("error", (error) => {
				options.log?.error(
					`Investigation child for job ${job.id} errored: ${error.message}`,
				);
				// A child that already reported its verdict owns it. Channel faults after
				// that point — a broken pipe while the child tears down — must never rewrite
				// a success as a retryable failure and rerun a finished investigation. The
				// exit handler settles with the reported outcome, and `exitTimer` bounds how
				// long that may take.
				if (reported) return;
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
			data: payload as StartMessage["data"],
		};
		// A failed `send` means the child will never receive its work, so it must not be
		// left running. Killing it drives the `exit` handler, which settles `done` as a
		// retryable failure — the right verdict for a transport fault.
		child.send(start, (error) => {
			if (!error) return;
			options.log?.error(
				`Could not hand job ${job.id} to its child: ${error.message}`,
			);
			child.kill("SIGKILL");
		});

		return {
			done,
			cancel: () => {
				if (settled || cancelRequested) return;
				cancelRequested = true;
				// The child disconnects its IPC channel the moment it has reported its
				// result, and settlement is deliberately withheld until it exits — so a
				// cancel pressed as a run finishes lands on a closed channel. A bare `send`
				// there makes Node emit `error` on the child, which used to settle an
				// already-succeeded run as a retryable failure and rerun it. Skip the send
				// when the channel is gone, and take the failure through a callback (which
				// suppresses the `error` event) when it dies mid-send.
				if (child.connected) {
					child.send({ type: "cancel" } satisfies HostMessage, (error) => {
						if (!error) return;
						options.log?.warn(
							`Could not deliver the cancel for job ${job.id}: ${error.message}`,
						);
					});
				}
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
