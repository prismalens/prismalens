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

function send(message: ChildMessage): void {
	// `process.send` exists only when forked with an IPC channel.
	process.send?.(message);
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
		updateProgress: async ({ percent, message }) => {
			send({ type: "progress", percent, message });
		},
	};

	let result: InvestigationResult;
	try {
		result = await processInvestigationJob(job, start.data, {
			emit: (event) => send({ type: "event", event }),
			streamDone: () => send({ type: "stream-done" }),
			signal: controller.signal,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Investigation run ${start.jobId} threw`, error);
		send({
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
				agentExecutions: [],
				error: message,
			},
		});
		return;
	}

	const outcome = result.success
		? "succeeded"
		: result.errorType === "cancelled"
			? "cancelled"
			: "failed";
	send({
		type: "result",
		outcome,
		// The run RETURNED rather than threw, so it reached a terminal verdict of its
		// own. Rerunning it would repeat a decided outcome, not recover from a fault.
		retryable: false,
		...(result.error ? { error: result.error } : {}),
		result,
	});
}

main()
	.then(() => {
		// Let the pending IPC sends flush before the event loop is torn down.
		setImmediate(() => process.exit(0));
	})
	.catch((error) => {
		logger.error("Investigation child failed fatally", error);
		setImmediate(() => process.exit(1));
	});
