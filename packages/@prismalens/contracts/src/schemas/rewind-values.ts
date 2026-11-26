// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/** Why a message can't be edited now, in the order they are checked. */
export const REWIND_BLOCKS = [
	"view-only",
	"not-yours",
	"running",
	"queued",
	"before-report",
] as const;
export type RewindBlock = (typeof REWIND_BLOCKS)[number];

/** Each block's words, for the menu's hint and the refusal. */
export const REWIND_BLOCK_WORDS: Readonly<Record<RewindBlock, string>> = {
	"view-only": "This device can view and answer, not edit",
	"not-yours": "Only your own messages can be edited",
	running: "Stop the thread first",
	queued: "Send or withdraw your queued messages first",
	"before-report":
		"Messages before the report can't be edited. Fork from here instead.",
};

/** The branches a rewind folds: the edited message's own, and the asks it raised. */
export function CONVERSATION_BRANCHES(messageBranch: string): string[] {
	return [messageBranch, "asks"];
}
