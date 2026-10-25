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
	| "error"
	| "fault"
	| "modes"
	| "parallel";

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
}
export function requestSummary(req: ChatCompletionRequest): RequestSummary;
