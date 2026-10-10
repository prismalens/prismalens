// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The {@link JobRunner} that actually runs an investigation: in-process,
 * inside the API's own event loop (0005 §2). Replaces the forked-child runner
 * — the engine still spawns the harness as its own child process; this is the
 * dispatch-loop-facing seam that used to fork a whole `@prismalens/worker`
 * entrypoint per run and now just calls a function.
 */

import type { InvestigationJobData } from "@prismalens/contracts";
import { createAskChannel, createSteerChannel } from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import type { JobRunner, RunningJob, RunSink } from "./dispatcher.js";
import runInvestigationJob, {
	type InvestigationResult,
} from "./investigation-run.js";
import type { ClaimedJob } from "./job-store.js";
import { payloadTurn } from "./prisma-investigation-store.js";
import type { RunPorts } from "./run-ports.js";

const logger = new Logger({ context: "InProcessRunner" });

export function createInProcessRunner(ports: RunPorts): JobRunner {
	return (job: ClaimedJob, sink: RunSink): RunningJob => {
		// Parse BEFORE running. A malformed payload is a permanent fault.
		let payload: InvestigationJobData;
		try {
			payload = JSON.parse(job.payload) as InvestigationJobData;
		} catch (error) {
			throw new Error(
				`Job ${job.id} has an unparseable payload: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		const controller = new AbortController();
		const steer = createSteerChannel();
		// Every ask waits on the operator; the row shows it so the board, the band and a notification can (#673 w21).
		const asks = createAskChannel({
			onChange: (since) => {
				ports
					.markAwaitingApproval(job.investigationId, since)
					.catch((e) => logger.warn("Could not record the waiting ask", e));
			},
		});
		const owes =
			payloadTurn({
				chat: !!payload.chat,
				...(payload.resume
					? {
							resume: {
								note: "",
								continuing: payload.resume.kind === "continue",
							},
						}
					: {}),
			}) === "report"
				? "continue"
				: "chat";

		// Idempotent: the run calls `streamDone` on every path it completes through,
		// but a thrown error or the sticky-cancel skip (returns without ever
		// conducting a run) would otherwise leave an SSE client waiting on a
		// producer that is gone — this guarantees exactly one close either way.
		let streamClosed = false;
		const closeStream = () => {
			if (streamClosed) return;
			streamClosed = true;
			sink.onStreamDone();
		};

		const done = runInvestigationJob(
			{
				id: job.id,
				investigationId: job.investigationId,
				attempts: job.attempts,
			},
			payload,
			{
				emit: (event) => sink.onEvent(event),
				streamDone: () => closeStream(),
				signal: controller.signal,
				steer: steer.port,
				permission: asks.policy,
			},
			ports,
		)
			.finally(() => asks.close())
			.then(
				(result: InvestigationResult) => {
					closeStream();
					const outcome =
						result.errorType === "cancelled"
							? ("cancelled" as const)
							: result.success
								? ("succeeded" as const)
								: ("failed" as const);
					return { outcome, ...(result.error ? { error: result.error } : {}) };
				},
				(error: unknown) => {
					closeStream();
					const message =
						error instanceof Error ? error.message : String(error);
					return { outcome: "failed" as const, error: message };
				},
			);

		return {
			done,
			cancel: () => controller.abort(),
			kill: () => controller.abort(),
			// The turn this job runs answers only what it owes (#804 OBJ-032).
			message: (text, mode, attachments, kind) =>
				kind && kind !== owes
					? "conflict"
					: steer.send(text, mode, attachments),
			answer: (askId, approve) => asks.answer(askId, approve),
		};
	};
}
