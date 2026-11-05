// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The {@link JobRunner} that actually runs an investigation: in-process,
 * inside the API's own event loop (0005 §2). Replaces the forked-child runner
 * — the engine still spawns the harness as its own child process; this is the
 * dispatch-loop-facing seam that used to fork a whole `@prismalens/worker`
 * entrypoint per run and now just calls a function.
 */

import { randomUUID } from "node:crypto";
import type {
	AskAnswer,
	InvestigationJobData,
	PendingAsk,
} from "@prismalens/contracts";
import {
	type AskChannel,
	createAskChannel,
	createSteerChannel,
	type HeldOutcome,
	type ToolAskEvent,
	type ToolAskPort,
} from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import type { JobRunner, RunningJob, RunSink } from "./dispatcher.js";
import runInvestigationJob, {
	type InvestigationResult,
} from "./investigation-run.js";
import type { ClaimedJob } from "./job-store.js";
import { payloadTurn } from "./prisma-investigation-store.js";
import { SHUTDOWN_REASON } from "./run-abort.js";
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
		let toolAsks: ReturnType<typeof toolAskHolder>;
		// Every ask waits on the operator; the row shows it so the board, the band and a notification can (#673 w21).
		const asks = createAskChannel({
			onChange: (since) => {
				ports
					.markAwaitingApproval(job.investigationId, since)
					.catch((e) => logger.warn("Could not record the waiting ask", e));
			},
		});
		toolAsks = toolAskHolder(asks);
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
				asks: {
					elicit: (askId, ask, ctx) =>
						asks.hold(askId, { kind: ask.kind, accepts: fits(ask.kind) }, ctx),
					toolAsks: toolAsks.port,
				},
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
			kill: () => controller.abort(SHUTDOWN_REASON),
			// The turn this job runs answers only what it owes (#804 OBJ-032).
			message: (text, mode, attachments, kind, id, context) =>
				kind && kind !== owes
					? "conflict"
					: steer.send(text, mode, attachments, id, context),
			answer: (askId, answer) => {
				const result = asks.answer(askId, answer);
				// ACP carries no reason on a rejection, so it follows as the next message (#1024).
				if (result?.reason)
					steer.send(result.reason, "queue", undefined, randomUUID());
				return result;
			},
			change: (messageId, text) => steer.change(messageId, text),
			openAsk: (ask) => toolAsks.open(ask, controller.signal),
		};
	};
}

/** An answer of the ask's own kind, or a decline, settles it. */
function fits(kind: PendingAsk["kind"]): (answer: AskAnswer) => boolean {
	return (answer) => answer.kind === "decline" || answer.kind === kind;
}

/** Holds PrismaLens tools' asks on the run's channel and queues their events for the run (#1024). */
function toolAskHolder(asks: AskChannel): {
	port: ToolAskPort;
	open(ask: PendingAsk, signal: AbortSignal): Promise<HeldOutcome>;
} {
	const queued: ToolAskEvent[] = [];
	let listener: (() => void) | null = null;
	const push = (e: ToolAskEvent) => {
		queued.push(e);
		listener?.();
	};
	return {
		port: {
			drain: () => queued.splice(0),
			onActivity(l) {
				listener = l;
				return () => {
					listener = null;
				};
			},
		},
		open(ask, signal) {
			push({ type: "opened", ask });
			const timeoutMs = ask.expiresAt
				? Math.max(1, Date.parse(ask.expiresAt) - Date.now())
				: 0;
			const held = asks.hold(
				ask.askId,
				{ kind: ask.kind, accepts: fits(ask.kind) },
				{ signal, timeoutMs },
			);
			void held.then((closed) =>
				push({
					type: "closed",
					askId: ask.askId,
					outcome: closed.outcome,
					// A secret's value is never recorded (#1024).
					...("answer" in closed && ask.kind !== "secret"
						? { answer: closed.answer }
						: {}),
				}),
			);
			return held;
		},
	};
}
