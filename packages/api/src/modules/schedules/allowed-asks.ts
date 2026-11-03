// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALWAYS_ALLOW_MAX,
	type AllowedAsk,
	AllowedAskSchema,
} from "@prismalens/contracts";

/** A schedule's remembered asks; anything unreadable is none. */
export function allowedAsks(json: string | null): AllowedAsk[] {
	if (!json) return [];
	try {
		const parsed = AllowedAskSchema.array().safeParse(JSON.parse(json));
		return parsed.success ? parsed.data : [];
	} catch {
		return [];
	}
}

/** The list with `ask` added once, newest last, capped: the oldest goes first (#1020 R33). */
export function withAsk(json: string | null, ask: AllowedAsk): string {
	const kept = allowedAsks(json).filter(
		(a) => a.kind !== ask.kind || a.identity !== ask.identity,
	);
	return JSON.stringify([...kept, ask].slice(-ALWAYS_ALLOW_MAX));
}
