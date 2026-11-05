// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ReferenceHit,
	ReferenceKind,
	ReferenceRef,
	ReferenceSnapshot,
} from "@prismalens/contracts";

export interface ReferenceQuery {
	q: string;
	kinds: readonly ReferenceKind[];
	threadId?: string;
	/** The workspace or project folder files are listed from; null before one exists. */
	root: string | null;
	limit: number;
}

/** A hit before ranking: the search scores and orders every provider's hits together. */
export type ReferenceCandidate = Omit<ReferenceHit, "why" | "score">;

/**
 * One kind of thing a message can refer to (#1024). Surface D's pull requests
 * plug in as a provider; `references.search` takes them all.
 */
export interface ReferenceProvider {
	readonly kinds: readonly ReferenceKind[];
	candidates(query: ReferenceQuery): Promise<ReferenceCandidate[]>;
	/** The bounded snapshot sent with the message; null when the record is gone. */
	snapshot(
		ref: ReferenceRef,
		run: { threadId: string | null; root: string | null },
	): Promise<ReferenceSnapshot | null>;
}

export const REFERENCE_PROVIDERS = Symbol("REFERENCE_PROVIDERS");
