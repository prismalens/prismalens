// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	agentName,
	type FailureMode,
	type HostStop,
	type ThreadRow,
} from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import type { ActionId } from "@/components/kit/actions";

type PauseReason = NonNullable<ThreadRow["paused"]>["reason"];

/** Why a thread reads Limited or Blocked: a provider stop, a host stop, or paused automatic updates. */
export type StopCause = FailureMode | HostStop | PauseReason;

/** Who raised a stop: PrismaLens itself, the agent, or the agent's model provider. */
export type StopSource = "prismalens" | "agent" | "provider";

/** Each source's name for the raw words under a stop's sentence (#1101 cat 23). */
export const STOP_SOURCE_WORDS: Readonly<Record<StopSource, string>> = {
	prismalens: "What PrismaLens recorded",
	agent: "The agent's error",
	provider: "The provider's error",
};

export interface StopCauseView {
	/** Limited waits on a clock; Blocked waits on the user. */
	state: "limited" | "blocked";
	/** Who raised it, which names its raw words. */
	source: StopSource;
	/** Its name on a row, the rail and a retry line: "Rate limited", "API key rejected". */
	name: string;
	/** The dock strip's bold head. */
	head: string;
	/** The thread's one plain line, naming the agent; a usage limit words its own by window. */
	line?: (agent: string) => string;
	/** Blocked only: what happens next, and the one thing to do. */
	next?: string;
	/** PrismaLens retries it on a short backoff, counting "try N of 5". */
	retries?: true;
	/** Its wait can lift early, so the dock offers Retry now while it waits. */
	retryNow?: true;
	/** The dock counts down to its next try instead of naming a clock time. */
	countdown?: true;
	/** While it waits, the dock offers another model or agent. */
	switchWhileWaiting?: true;
	/** The agent's settings fix it, so the dock offers Update key first. */
	fixInSettings?: true;
	/**
	 * The account page that clears it: PrismaLens can't change it, so the action is
	 * named for where it goes ("Open Anthropic limits") and `word` says what to do there.
	 */
	account?: { page: "billing" | "limits"; word: string };
	/** Try again can't lift it: only a change on the account does, then a new message. */
	noTryAgain?: true;
	/** The registered action a card offers to fix it. */
	fix?: ActionId;
}

const cap = agentName;

const STOP_CAUSES: Record<StopCause, StopCauseView> = {
	usage_limit: {
		state: "limited",
		source: "provider",
		name: "Usage limit",
		head: "Usage limit reached",
		retryNow: true,
		switchWhileWaiting: true,
	},
	rate_limited: {
		state: "limited",
		source: "provider",
		name: "Rate limited",
		head: "Rate limited",
		line: (agent) => `${cap(agent)}'s provider limited the request rate`,
		retries: true,
	},
	overloaded: {
		state: "limited",
		source: "provider",
		name: "Provider busy",
		head: "Provider busy",
		line: (agent) => `${cap(agent)}'s provider was busy`,
		retries: true,
		retryNow: true,
		countdown: true,
	},
	out_of_credit: {
		state: "blocked",
		source: "provider",
		name: "Out of credit",
		head: "Out of credit",
		line: (agent) => `${cap(agent)} is out of credit on its API account`,
		next: "Nothing happens by itself. Add credit, then Try again. Your draft is kept.",
		account: { page: "billing", word: "Add credit" },
		fix: "needs.addCredit",
	},
	key_rejected: {
		state: "blocked",
		source: "provider",
		name: "API key rejected",
		head: "API key rejected",
		line: (agent) => `${cap(agent)}'s API key was rejected`,
		next: "Nothing happens by itself. Update the key in the agent's settings, then Try again. Your draft is kept.",
		// A key is fixed in the agent's settings, never on a billing page.
		fixInSettings: true,
		fix: "needs.updateKey",
	},
	spend_cap: {
		state: "blocked",
		source: "provider",
		name: "Spend cap reached",
		head: "Spend cap reached",
		line: () => "Your organization's spend cap was reached",
		next: "PrismaLens can't change this cap. Raise it on the provider's account, then send your message again. Your draft is kept.",
		account: { page: "limits", word: "Raise the cap" },
		noTryAgain: true,
		fix: "needs.raiseCap",
	},
	disk_full: {
		state: "blocked",
		source: "prismalens",
		name: "No disk space left for its worktree",
		head: "No disk space left for its worktree",
		next: "Nothing happens by itself. Free space by removing old workspaces, then send your message again. Your draft is kept.",
		fix: "needs.freeSpace",
	},
	ceiling: {
		state: "blocked",
		source: "prismalens",
		name: "daily ceiling",
		head: "Automatic updates paused",
	},
	loop_guard: {
		state: "blocked",
		source: "prismalens",
		name: "loop guard",
		head: "Automatic updates paused",
	},
};

/** Every cause behind Limited and Blocked, with its words and its fix (#1101 categories 2, 17, 23). */
export const stopCauses = defineClosed(
	"stopCause",
	Object.keys(STOP_CAUSES) as StopCause[],
	STOP_CAUSES,
);

export const stopCause = (c: StopCause): StopCauseView => stopCauses.get(c);

/** Each cause's card fix, for the Blocked status's rule. */
export const causeFixes: Readonly<Record<string, ActionId>> =
	Object.fromEntries(
		stopCauses.members.flatMap((c) => {
			const fix = stopCauses.get(c).fix;
			return fix ? [[c, fix]] : [];
		}),
	);
