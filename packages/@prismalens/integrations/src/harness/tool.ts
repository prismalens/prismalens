// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A PrismaLens harness tool: one capability the per-run gateway serves to the agent
 * (#848, ADR 0007 §5). Data-access tools are the user's own, never declared here.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** At most 46 characters and never `__`, which agents use to join server and tool names. */
export const HARNESS_TOOL_NAME = /^[a-z][a-z0-9_]{2,45}$/;

/**
 * What a tool may do. `read`: PrismaLens's own records. `record`: append to this run's
 * own record, nothing outside it. Later levels (`ask`, `act`) join this union additively.
 */
export type HarnessEffect = "read" | "record";

export type HarnessGroup = "core" | "knowledge" | "record";

/** The fixed failure codes every tool answers with; the agent reads `next`. */
export const FAILURE_CODES = [
	"invalid_input",
	"not_found",
	"disabled",
	"run_ended",
	"timeout",
	"internal",
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
	/** `z.object({})` for no arguments; never a run id, which comes from the bearer. */
	input: S;
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
 * agents that approve by the hint let a read-only run record (#930).
 */
export function annotationsFor(_effect: HarnessEffect) {
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
