// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The tool port: one PrismaLens harness capability the gateway serves to agents (#848).
 * Data-access tools are the user's own, never PrismaLens's (#848 ruling 2026-10-24).
 */
import type { SourceCategory } from "@prismalens/contracts/schemas";
import type { z } from "zod";

/** At most 46 characters and never `__`, which agents use to join server and tool names. */
export const SOURCE_TOOL_NAME = /^[a-z][a-z0-9_]{2,45}$/;

export interface SourceToolContext {
	runId: string;
	signal: AbortSignal;
}

export interface SourceToolResult {
	value: unknown;
	isError?: boolean;
	/** Exact values scrubbed from the serialised result. */
	secrets?: string[];
}

export interface SourceTool<S extends z.ZodObject = z.ZodObject> {
	name: string;
	title: string;
	description: string;
	/** `z.object({})` for no arguments. */
	input: S;
	/** Availability is the category's status in the view. */
	category: SourceCategory;
	openWorld: boolean;
	run(input: z.output<S>, ctx: SourceToolContext): Promise<SourceToolResult>;
}

export class SourceToolRefused extends Error {}

/** Keeps a tool's `run` typed by its own input schema. */
export function defineSourceTool<S extends z.ZodObject>(
	tool: SourceTool<S>,
): SourceTool {
	return tool as unknown as SourceTool;
}
