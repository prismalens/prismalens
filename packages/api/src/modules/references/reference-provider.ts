// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ReferenceHit,
	ReferenceKind,
	ReferenceRef,
	ReferenceSnapshot,
} from "@prismalens/contracts";

/** Where a search runs: the thread, its subject, and the folder files are listed from. */
export interface ReferenceContext {
	threadId?: string;
	/** A project thread's repository: its own items come first under `#`. */
	repositoryId?: string;
	/** An incident thread's incident: its records come first. */
	incidentId?: string;
	/** The workspace or project folder files are listed from; null before one exists. */
	root: string | null;
	/** The kinds the trigger asks for; a provider skips the search when it serves none. */
	kinds: readonly ReferenceKind[];
	limit: number;
	signal?: AbortSignal;
}

/** A hit before ranking: the search scores and orders every provider's hits together. */
export type ReferenceCandidate = Omit<ReferenceHit, "why" | "score">;

/** A source that cannot answer right now: one line in the menu, never a failed search. */
export class SourceUnavailable extends Error {
	constructor(
		readonly source: string,
		message: string,
	) {
		super(message);
	}
}

/**
 * One source a message can refer to (#1024): PrismaLens's own records, a repo host's
 * issues and pull requests, a monitoring source's alerts. Lane B registers the
 * sources' providers. A provider throws `SourceUnavailable` for an unreachable or
 * credential-less source; the others still answer.
 */
export interface ReferenceProvider {
	/** Shown on its unavailable line and as the hits' default group. */
	readonly source: string;
	readonly kinds: readonly ReferenceKind[];
	search(q: string, ctx: ReferenceContext): Promise<ReferenceCandidate[]>;
	/** `#123`; `mergeRequest` for `!123`. */
	byNumber?(
		n: number,
		ctx: ReferenceContext & { mergeRequest: boolean },
	): Promise<ReferenceCandidate[]>;
	/** A tracker key such as `PROJ-123`. */
	byKey?(key: string, ctx: ReferenceContext): Promise<ReferenceCandidate[]>;
	/** The bounded snapshot sent with the message; null when the record is gone. */
	snapshot(
		ref: ReferenceRef,
		ctx: { threadId: string | null; root: string | null },
	): Promise<ReferenceSnapshot | null>;
}

export const REFERENCE_PROVIDERS = Symbol("REFERENCE_PROVIDERS");
