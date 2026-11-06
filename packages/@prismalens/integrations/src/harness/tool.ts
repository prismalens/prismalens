// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A PrismaLens harness tool: one capability the per-run gateway serves to the agent
 * (#848, ADR 0007 §5). Data-access tools are the user's own, never declared here.
 */
import { createHash } from "node:crypto";
import {
	THREAD_SUBJECTS,
	type ThreadSubjectKind,
} from "@prismalens/contracts/schemas";
import { z } from "zod";

/** At most 46 characters and never `__`, which agents use to join server and tool names. */
export const HARNESS_TOOL_NAME = /^[a-z][a-z0-9_]{2,45}$/;

/**
 * What a tool may do. `read`: PrismaLens's own records. `record`: append to this run's
 * own record, nothing outside it. `ask`: open an ask the user answers, nothing else.
 * `act`: change something beyond the run, behind PrismaLens's own approval, never
 * the agent's permission prompt (#1024 spec F).
 */
export type HarnessEffect = "read" | "record" | "ask" | "act";

export type HarnessGroup = "core" | "knowledge" | "record";

/**
 * Where a tool works (#1020): the thread subjects whose data it reads, and `owes: "report"`
 * for a report's own tools. A run's view is derived from this, so no offered tool always fails.
 */
export interface HarnessServes {
	subjects: readonly ThreadSubjectKind[];
	owes?: "report";
	/** Also served to any member of a thread tree, whatever its subject (#1024). */
	tree?: true;
	/** Only a run a person can answer: not one an alert or schedule started unwatched (#1024 spec B). */
	attended?: true;
	/** Agents whose own tool already does this through the client (e.g. a question by elicitation). */
	notFor?: readonly string[];
	/** Its asks are answered in the ask dock: offered only to a scope that says the dock exists. */
	dock?: true;
}

/** Every subject: tools that need nothing but the run itself. */
export const EVERY_SUBJECT: readonly ThreadSubjectKind[] = THREAD_SUBJECTS;

/** What a run is: its subject and what it owes; unknown keeps every tool. */
export interface HarnessScope {
	subject?: ThreadSubjectKind;
	owes?: "answer" | "report";
	/** The run is a member of a thread tree (#1024). */
	tree?: boolean;
	/** False for a run nobody can answer; unknown keeps every tool. */
	attended?: boolean;
	/** The agent the run is in. */
	agent?: string;
	/** The UI can answer a tool's question or secret ask. */
	dock?: boolean;
}

/** The tools a run's scope can use; replay reads recorded events, not this. */
export function servedTo(
	tools: readonly HarnessTool[],
	{ subject, owes, tree, attended, agent, dock }: HarnessScope,
): readonly HarnessTool[] {
	return tools.filter(
		(t) =>
			(!subject ||
				t.serves.subjects.includes(subject) ||
				(!!tree && !!t.serves.tree)) &&
			(!owes || !t.serves.owes || t.serves.owes === owes) &&
			(!t.serves.attended || attended !== false) &&
			(!agent || !t.serves.notFor?.includes(agent)) &&
			(!t.serves.dock || dock === true),
	);
}

/** The fixed failure codes every tool answers with; the agent reads `next`. */
export const FAILURE_CODES = [
	"invalid_input",
	"not_found",
	"disabled",
	"run_ended",
	"timeout",
	"internal",
	// A configured cap refused it; `next` names the cap and its Settings row (#1024).
	"limit_reached",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export interface Failure {
	failure: { error: FailureCode; message: string; next: string };
}

export const fail = (
	error: FailureCode,
	message: string,
	next: string,
): Failure => ({ failure: { error, message, next } });

export const isFailure = (r: unknown): r is Failure =>
	typeof r === "object" && r !== null && "failure" in r;

export interface ToolSuccess {
	value: unknown;
	/** Exact values scrubbed from the serialised result. */
	secrets?: readonly string[];
}

export type ToolOutcome = ToolSuccess | Failure;

/** What every tool receives; a `record` tool's data port is bound to `runId` too. */
export interface ToolContext {
	/** The bearer's run; a tool's input never names one. */
	runId: string;
	signal: AbortSignal;
}

export interface HarnessTool<
	S extends z.ZodObject = z.ZodObject,
	E extends HarnessEffect = HarnessEffect,
> {
	name: string;
	title: string;
	description: string;
	group: HarnessGroup;
	effect: E;
	serves: HarnessServes;
	/** `z.object({})` for no arguments; never a run id, which comes from the bearer. */
	input: S;
	/** How long one call may run; the registry's default when absent. */
	timeoutMs?: number;
	run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Keeps a tool's `run` typed by its own input and effect. */
export function defineHarnessTool<
	S extends z.ZodObject,
	E extends HarnessEffect,
>(tool: HarnessTool<S, E>): HarnessTool {
	return tool as unknown as HarnessTool;
}

export class HarnessToolRefused extends Error {}

/**
 * MCP annotations follow from the level; a tool never sets its own. A `record` tool writes
 * only PrismaLens's record of this run, never the user's systems, so it is read-only too and
 * agents that approve by the hint let a read-only run record (#930). An `act` tool changes
 * PrismaLens's threads, never the user's systems, and only once the user approves.
 */
export function annotationsFor(effect: HarnessEffect): {
	readOnlyHint: boolean;
	destructiveHint?: boolean;
	openWorldHint: boolean;
} {
	if (effect === "act")
		return {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		};
	return { readOnlyHint: true, openWorldHint: false };
}

type JsonSchemaObject = { type: "object"; [k: string]: unknown };

export const inputSchemaOf = (tool: HarnessTool): JsonSchemaObject =>
	z.toJSONSchema(tool.input, { io: "input" }) as JsonSchemaObject;

/** Which input shape a recorded call was made with. */
export const schemaHashOf = (tool: HarnessTool): string =>
	createHash("sha256")
		.update(JSON.stringify(inputSchemaOf(tool)))
		.digest("hex")
		.slice(0, 16);
