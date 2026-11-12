// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { formatClock } from "@/lib/format-time";

export type ConnectionState =
	| "connected"
	| "connecting"
	| "reconnecting"
	| "unreachable";

/** A drop shorter than this reads as Connecting: a page load or a blink. */
export const CONNECTING_MS = 3_000;
/** Down this long, the host is unreachable rather than reconnecting. */
export const UNREACHABLE_AFTER_MS = 45_000;

export interface ConnectionWord {
	state: ConnectionState;
	/** The header's word: never a colour alone (#1101 category 5 item 1). */
	word: string;
	/** Why, and what happens next, in one line a phone fits; null while connected. */
	reason: string | null;
	/** "What you see is as of 2:02 PM."; null while connected. */
	asOf: string | null;
}

/** The phone header's connection word, from the change stream's status. */
export function connectionWord(
	s: { connected: boolean; lostAt: number },
	now: number,
	online = true,
	clock: (at: number) => string = formatClock,
): ConnectionWord {
	if (s.connected)
		return { state: "connected", word: "Connected", reason: null, asOf: null };
	const down = now - s.lostAt;
	const asOf = `What you see is as of ${clock(s.lostAt)}.`;
	if (!online)
		return {
			state: "unreachable",
			word: "Host unreachable",
			reason: "This phone is offline; reconnects when it's back.",
			asOf,
		};
	if (down < CONNECTING_MS)
		return {
			state: "connecting",
			word: "Connecting",
			reason: null,
			asOf: null,
		};
	if (down < UNREACHABLE_AFTER_MS)
		return {
			state: "reconnecting",
			word: `Reconnecting (as of ${clock(s.lostAt)})`,
			reason: "Connection lost, retrying.",
			asOf,
		};
	return {
		state: "unreachable",
		word: "Host unreachable",
		reason: "Your computer may be asleep; reconnects when it's back.",
		asOf,
	};
}
