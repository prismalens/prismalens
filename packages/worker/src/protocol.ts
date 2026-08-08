// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The IPC protocol between the API's dispatch loop (the host) and the per-run
 * investigation child it forks.
 *
 * This channel carries what Redis pub/sub used to: canonical events on their way to the
 * SSE relay, and the out-of-band cancel request on their way back. Nothing here is a
 * queue — the durable claim lives in the JobStore, and this socket only exists for as
 * long as one run does.
 */

import type {
	CanonicalEvent,
	InvestigationJobData,
} from "@prismalens/contracts";
import type { InvestigationResult } from "./types.js";

/** Host → child: run this job. Sent exactly once, immediately after the fork. */
export interface StartMessage {
	type: "start";
	jobId: string;
	attempt: number;
	data: InvestigationJobData;
}

/** Host → child: stop the run. The child aborts, tears down, and reports `cancelled`. */
export interface CancelMessage {
	type: "cancel";
}

export type HostMessage = StartMessage | CancelMessage;

/** Child → host: one canonical event, for the relay. */
export interface EventMessage {
	type: "event";
	event: CanonicalEvent;
}

/** Child → host: progress for the run's status surface. */
export interface ProgressMessage {
	type: "progress";
	percent: number;
	message: string;
}

/** Child → host: the stream is finished; close the relay. */
export interface StreamDoneMessage {
	type: "stream-done";
}

/**
 * Child → host: the terminal outcome.
 *
 * `retryable` is the child's own verdict, not the host's: a configuration contradiction
 * (a harness that cannot honour the demanded sandbox) can never succeed on a rerun, so
 * it says so instead of burning the attempt budget.
 */
export interface ResultMessage {
	type: "result";
	outcome: "succeeded" | "failed" | "cancelled";
	retryable: boolean;
	error?: string;
	result: InvestigationResult;
}

export type ChildMessage =
	| EventMessage
	| ProgressMessage
	| StreamDoneMessage
	| ResultMessage;

/**
 * Thrown by the run when the failure is a contradiction a rerun cannot resolve.
 * The host maps it to `retryable: false`.
 */
export class UnrecoverableJobError extends Error {
	readonly retryable = false;
	constructor(message: string) {
		super(message);
		this.name = "UnrecoverableJobError";
	}
}
