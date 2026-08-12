// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The per-run investigation child.
 *
 * The host (the API's dispatch loop) claims a job from the JobStore and forks ONE of
 * these per run. There is no queue client here, no broker connection, and no polling —
 * this process receives exactly one `start` message, runs one investigation, reports its
 * outcome, and exits.
 *
 * **Why fork at all.** Not for credential isolation: that design no longer exists —
 * credentials are fetched per-run over the internal endpoint and held in memory, and
 * there are zero `process.env` assignments in this package or in `@prismalens/engine`.
 * The fork earns its keep as CRASH AND MEMORY ISOLATION of the Tier-1 loop from the API
 * process. A wedged harness, an OOM, or a native-module segfault takes down one child;
 * the API keeps serving, the claim's heartbeat stops, and the job is reclaimed and rerun.
 * Do NOT use worker threads for this — a thread shares the heap and the crash domain,
 * which is precisely what the fork is buying.
 */

import "dotenv/config";

import { createLogger } from "@prismalens/logger/standalone";
import processInvestigationJob, { type JobContext } from "./processor.js";
import type { ChildMessage, HostMessage } from "./protocol.js";
import type { InvestigationResult } from "./types.js";

const logger = createLogger({
	service: {
		name: "prismalens-investigation-run",
		version: "0.1.0",
		environment: process.env.NODE_ENV ?? "development",
	},
	context: "InvestigationRun",
});

/** Exit code used when the child was started without a usable IPC channel. */
const EXIT_NO_IPC = 2;

/**
 * Send one message and resolve once it has actually been handed to the channel.
 *
 * This is awaited everywhere, and that matters most for the terminal `result`: an
 * un-awaited send followed by `process.exit` can tear the channel down with the message
 * still queued. The host would then see a child that exited without reporting, judge it
 * a crash, and RERUN a job that had already decided its outcome.
 */
function send(message: ChildMessage): Promise<void> {
	return new Promise((resolve) => {
		// `process.send` exists only when forked with an IPC channel.
		if (!process.send) return resolve();
		const flushed = process.send(message, undefined, undefined, () =>
			resolve(),
		);
		// A `false` return means the channel is backed up but the callback still fires;
		// a throw would have rejected. Nothing else to do here.
		if (flushed === undefined) resolve();
	});
}

/**
 * A thrown error is a fault, and faults are worth a rerun — unless the run itself
 * declared the failure unrecoverable (a configuration contradiction no rerun can fix).
 */
function isRetryable(error: unknown): boolean {
	return !(
		error instanceof Error &&
		(error.name === "UnrecoverableJobError" ||
			(error as { retryable?: boolean }).retryable === false)
	);
}

async function main(): Promise<void> {
	if (typeof process.send !== "function") {
		logger.error(
			"No IPC channel — this process is forked per run by the API dispatch loop, not run standalone",
		);
		process.exit(EXIT_NO_IPC);
	}

	const start = await new Promise<HostMessage>((resolve) => {
		process.once("message", (message: HostMessage) => resolve(message));
	});

	if (start.type !== "start") {
		logger.error(`Expected a "start" message, got "${start.type}"`);
		process.exit(EXIT_NO_IPC);
	}

	const controller = new AbortController();
	process.on("message", (message: HostMessage) => {
		if (message.type === "cancel") {
			logger.info(`Cancel requested for job ${start.jobId}`);
			controller.abort();
		}
	});

	const job: JobContext = {
		id: start.jobId,
		name: "investigate",
		attemptsMade: start.attempt,
		updateProgress: ({ percent, message }) =>
			send({ type: "progress", percent, message }),
	};

	// Whether the run got as far as closing its own stream. It does so on every path
	// conductRun completes, but not when the run threw first or was skipped as already
	// cancelled — and an SSE client must never be left waiting on a producer that is gone.
	let streamClosed = false;
	const closeStream = async () => {
		if (streamClosed) return;
		streamClosed = true;
		await send({ type: "stream-done" });
	};

	let result: InvestigationResult;
	try {
		result = await processInvestigationJob(job, start.data, {
			emit: (event) => send({ type: "event", event }),
			streamDone: closeStream,
			signal: controller.signal,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Investigation run ${start.jobId} threw`, error);
		await closeStream();
		await send({
			type: "result",
			outcome: "failed",
			retryable: isRetryable(error),
			error: message,
			result: {
				success: false,
				investigationId: start.data.investigationId,
				incidentId: start.data.incidentId,
				findings: {},
				recommendations: [],
				error: message,
			},
		});
		return;
	}

	// The sticky-cancel skip returns without conducting a run, so the stream never
	// closed itself.
	await closeStream();

	const outcome = result.success
		? "succeeded"
		: result.errorType === "cancelled"
			? "cancelled"
			: "failed";
	await send({
		type: "result",
		outcome,
		// The run RETURNED rather than threw, so it reached a terminal verdict of its
		// own. Rerunning it would repeat a decided outcome, not recover from a fault.
		retryable: false,
		...(result.error ? { error: result.error } : {}),
		result,
	});
}

/**
 * Close the channel and let the process end on its own.
 *
 * NOT `process.exit`: every send above is awaited, but a forcible exit would still cut
 * short anything the runtime has yet to flush, and the host reads a child that exited
 * without reporting as a crash worth rerunning. Disconnecting drops the last handle
 * keeping the loop alive, so a well-behaved run exits 0 by simply running out of work —
 * and a run that leaked a handle is a bug worth seeing rather than papering over.
 */
function finish(code: number): void {
	process.exitCode = code;
	if (typeof process.disconnect === "function") process.disconnect();
}

main()
	.then(() => finish(0))
	.catch((error) => {
		logger.error("Investigation child failed fatally", error);
		finish(1);
	});
