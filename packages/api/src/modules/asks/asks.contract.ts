// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AskAnswer,
	AskClosedOutcome,
	PendingAsk,
} from "@prismalens/contracts";

/** What `open` takes: the service fills `askId`, `threadId` and `openedAt`. */
export type OpenAsk = Omit<PendingAsk, "askId" | "threadId" | "openedAt"> & {
	/** Set by an engine ask that already has an id (an ACP request). */
	askId?: string;
};

export interface ClosedAsk {
	ask: PendingAsk;
	outcome: AskClosedOutcome;
	/** Never set on a `secret` ask. */
	answer?: AskAnswer;
	closedAt: string;
}

/** Who answers: the host's own session, a paired device, or a run's bearer token. */
export interface AskAnswerer {
	host: boolean;
	via: "session" | "device" | "run" | "push";
}

/**
 * The one seat every ask goes through (#1024): engine permission and elicitation
 * asks, and PrismaLens tools' asks (`source.kind = "tool"`, surfaces B and F).
 * `onClosed` handlers run in-process only: a caller that must outlive a restart keeps
 * its own state keyed by `askId` and re-reads the ask through `get` at boot.
 */
export interface AsksPort {
	open(threadId: string, ask: OpenAsk): Promise<string>;
	/** Throws `AskConflict` when the ask no longer waits, `AskForbidden` on `requiresHost`. */
	answer(
		threadId: string,
		askId: string,
		answer: AskAnswer,
		by: AskAnswerer,
	): Promise<ClosedAsk>;
	pending(threadId: string): Promise<PendingAsk[]>;
	get(
		askId: string,
	): Promise<{ ask: PendingAsk; closed: ClosedAsk | null } | null>;
	onClosed(askId: string, handler: (closed: ClosedAsk) => void): () => void;
}

export const ASKS_PORT = Symbol("ASKS_PORT");

export class AskConflict extends Error {}
export class AskForbidden extends Error {}
