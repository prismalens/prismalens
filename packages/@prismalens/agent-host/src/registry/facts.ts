// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What PrismaLens relies on an agent to do, each with the versions it was last checked on.
 * `probe` facts are asserted every night from `initialize`; `source` facts were read in the
 * agent's source and fail the pin-bump PR's check until someone reads them again.
 */

/** How a fact was checked: the zero-token probe, or reading the agent's source. */
export type FactCheck = "probe" | "source";

/** The versions a fact was checked on: the CLI, and the ACP adapter for a row with one. */
export interface FactVersions {
	cli: string;
	adapter: string | null;
}

export interface AgentFact<V, C extends FactCheck = FactCheck> {
	value: V;
	via: C;
	verifiedAt: FactVersions;
	/** For a `source` fact: the file and symbol that were read. */
	where?: string;
}

/** What a stop does to a turn's in-session sub-agents, as far as the agent lets PrismaLens choose. */
export interface SubagentStopFacts {
	stop: boolean;
	finish: boolean;
	/** One line for Settings: what the agent does with its sub-agents on a stop. */
	note: string;
}

export interface AgentFacts {
	/** `session/load` or `session/resume` is offered, so a finished thread can be reopened. */
	loadSession: AgentFact<boolean, "probe">;
	/** The prompt takes image blocks. */
	images: AgentFact<boolean, "probe">;
	/** The prompt takes embedded resources. */
	embeddedContext: AgentFact<boolean, "probe">;
	/** A session can be given folders beyond its cwd. */
	directories: AgentFact<boolean, "probe">;
	/** The brief goes in as `_meta.systemPrompt.append`; absent, in the first prompt. */
	systemPromptVia?: AgentFact<"claude-meta", "source">;
	/** The adapter joins every text block once a file goes as a link; absent, it keeps their order. */
	regroupsLinks?: AgentFact<true, "source">;
	/** What a stop does to its sub-agents; absent, unknown. */
	subagentsOnStop?: AgentFact<SubagentStopFacts, "source">;
}

/** As much of an `initialize` answer as the probed facts read. */
export interface InitializeAnswer {
	agentCapabilities?: {
		loadSession?: boolean | null;
		promptCapabilities?: {
			image?: boolean | null;
			embeddedContext?: boolean | null;
		} | null;
		sessionCapabilities?: {
			resume?: unknown;
			additionalDirectories?: unknown;
		} | null;
	} | null;
}

type Probed = {
	[K in keyof AgentFacts]-?: AgentFacts[K] extends AgentFact<unknown, "probe">
		? K
		: never;
}[keyof AgentFacts];

/** How the probe reads each probed fact; the same reads the engine makes at run time. */
export const PROBED_FACTS: Readonly<
	Record<Probed, (init: InitializeAnswer) => boolean>
> = {
	loadSession: (i) =>
		i.agentCapabilities?.loadSession === true ||
		i.agentCapabilities?.sessionCapabilities?.resume != null,
	images: (i) => i.agentCapabilities?.promptCapabilities?.image === true,
	embeddedContext: (i) =>
		i.agentCapabilities?.promptCapabilities?.embeddedContext === true,
	directories: (i) =>
		i.agentCapabilities?.sessionCapabilities?.additionalDirectories != null,
};

/** Each probed fact the agent's answer contradicts, as `name: row X, agent Y`. */
export function factMismatches(
	facts: AgentFacts | undefined,
	init: InitializeAnswer,
): string[] {
	if (!facts) return [];
	return (Object.keys(PROBED_FACTS) as Probed[]).flatMap((name) => {
		const seen = PROBED_FACTS[name](init);
		return seen === facts[name].value
			? []
			: [`${name}: registry ${facts[name].value}, agent ${seen}`];
	});
}

/** Each fact not checked on `at`, as `name (via, cli X, adapter Y)`. */
export function staleFacts(
	facts: AgentFacts | undefined,
	at: FactVersions,
	via?: FactCheck,
): string[] {
	if (!facts) return [];
	return Object.entries(facts).flatMap(([name, f]) => {
		const fact = f as AgentFact<unknown>;
		if (via && fact.via !== via) return [];
		const { cli, adapter } = fact.verifiedAt;
		return cli === at.cli && adapter === at.adapter
			? []
			: [
					`${name} (${fact.via}, checked on cli ${cli}${adapter ? `, adapter ${adapter}` : ""})`,
				];
	});
}
