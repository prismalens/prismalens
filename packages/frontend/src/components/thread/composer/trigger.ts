// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceTrigger } from "@prismalens/contracts";

/** The trigger the caret sits in, and the text it replaces when a hit is picked. */
export interface ActiveTrigger {
	trigger: ReferenceTrigger;
	query: string;
	/** Offset of the trigger character. */
	start: number;
	/** The caret: the query runs from `start + 1` to here. */
	end: number;
}

/**
 * The menu's trigger at the caret (#1024): `/` at the start of a line, `@` and `#`
 * at the start or after whitespace. Whitespace ends the query, so a space after
 * `@sam` closes the menu and leaves plain text; nothing becomes a mention unpicked.
 */
export function activeTrigger(
	text: string,
	caret: number,
): ActiveTrigger | null {
	let i = caret - 1;
	while (i >= 0) {
		const ch = text[i] as string;
		if (/\s/.test(ch)) return null;
		if (ch === "/" || ch === "@" || ch === "#") {
			const before = i === 0 ? "\n" : (text[i - 1] as string);
			const lineStart = before === "\n";
			const afterSpace = /\s/.test(before);
			if (ch === "/" ? !lineStart : !afterSpace) {
				i--;
				continue;
			}
			return {
				trigger: ch,
				query: text.slice(i + 1, caret),
				start: i,
				end: caret,
			};
		}
		i--;
	}
	return null;
}

/** The text with the trigger and its query taken out, and where the caret goes. */
export function removeTrigger(
	text: string,
	t: Pick<ActiveTrigger, "start" | "end">,
): { text: string; caret: number } {
	const after = text.slice(t.end).replace(/^ /, "");
	return { text: text.slice(0, t.start) + after, caret: t.start };
}

/** The agent group's rows before the user types a query (#1024). */
export const AGENT_ROWS_UNTYPED = 5;
