// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ChatCompletionRequest,
	Fixture,
	FixtureFileEntry,
	JournalEntry,
} from "@copilotkit/aimock";

/** One agent's shell tool: its name, the argument holding the command, and any it requires. */
export interface AgentTools {
	shell: string;
	command: string;
	extra: Record<string, unknown>;
	/** Arguments that make the agent ask before it runs the command (`$ask`). */
	ask?: Record<string, unknown>;
}

/** What drives one matrix row through the engine. */
export interface RowRun {
	accessLevel?: "supervised" | "auto-edits" | "auto" | "full-access";
	/** The person's answer to every ask the row raises. */
	answer?: "allow" | "deny";
	/** Cancels the run once a process whose command line holds this string runs. */
	cancelWhenRunning?: string;
	/** The agent starts with no key and an empty home. */
	signedOut?: boolean;
	/** Opens a session and reads `session/new`; no prompt is sent. */
	sessionOnly?: boolean;
	promptTimeoutMs?: number;
}

export type Expectation =
	| "report"
	| "tool-report"
	| "allowed"
	| "declined"
	| "cancelled"
	/** Known failure: cancelled, but the tool's process outlives the run; fails once the agent fixes it. */
	| "cancelled-orphaned"
	| "error"
	| "fault"
	/** The agent exits before it answers anything, and PrismaLens says so. */
	| "exited"
	| "modes"
	| "parallel"
	/** PrismaLens's own tools were called as `gateway` says, and the run reported (#848). */
	| "gateway";

/** What a `gateway` row expects PrismaLens's tools to have recorded, in order. */
export interface GatewayExpectation {
	/** `input` is matched as a subset of what the call carried. */
	calls: {
		name: string;
		ok: boolean;
		outputHas?: string;
		input?: Record<string, unknown>;
	}[];
	records?: { evidence?: string[]; hypotheses?: string[] };
	/** Words each recorded evidence item's observation must hold, by id. */
	evidenceHas?: Record<string, string>;
	/** Each recorded evidence item's exact quote, by id. */
	evidenceQuote?: Record<string, string>;
	/** Each recorded hypothesis's status and the evidence ids it links, by id. */
	hypothesisIs?: Record<string, { status: string; evidenceIds: string[] }>;
	/** Titles of the HTML pages the run must have published (#871). */
	artifacts?: string[];
}

export interface Row {
	row: string;
	kind: "happy" | "negative";
	title: string;
	run: RowRun;
	expect: Expectation;
	/** Where an agent legitimately differs: its outcome and the one-line reason. */
	agents?: Record<string, { expect: Expectation; why: string }>;
	/** A fault this agent's wire cannot express, and why. */
	na?: Record<string, string>;
	gateway?: GatewayExpectation;
	fixtures: FixtureFileEntry[];
}

export interface ScriptedModel {
	url: string;
	/** The OpenAI-compatible base URL, `<url>/v1`. */
	openaiBaseUrl: string;
	journal(): JournalEntry[];
	/** Each request the agent sent, as `requestSummary` reads it. */
	requests(): RequestSummary[];
	resetMatchCounts(): void;
	close(): Promise<void>;
}

export const SCENARIOS_DIR: string;
export const SCRIPTED_KEY: string;
export const SCRIPTED_REPORT: Record<string, unknown>;
export function agentTools(): Record<string, AgentTools>;
export function matrixRows(): Row[];
export function resolveEntry(
	entry: FixtureFileEntry,
	tools: AgentTools,
	mainLoop: boolean,
): Fixture;
export function fixturesFor(harness: string): Fixture[];
export function startScriptedModel(
	harness: string,
	options?: { port?: number },
): Promise<ScriptedModel>;
export interface RequestSummary {
	model: string;
	tools: string[];
	last: string;
	/** The matrix row the conversation belongs to, from its `[row:<id>]` marker. */
	row: string | null;
	/** Characters of PrismaLens's own tool definitions in this request (#848). */
	plDefChars: number;
	/** `tools_search` results carried back to the model, characters by call id. */
	searchResults: Record<string, number>;
}
export function requestSummary(req: ChatCompletionRequest): RequestSummary;
