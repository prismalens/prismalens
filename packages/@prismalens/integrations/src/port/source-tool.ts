// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The source port: one read the gateway serves to agents as a PrismaLens tool (#848).
 * Proxied vendor MCP tools are not SourceTools; they go through `ProxyPort`.
 */
import type { SourceCategory } from "@prismalens/contracts/schemas";
import type { z } from "zod";

export const SIDE_EFFECTS = [
	"none",
	"read_only",
	"mutating",
	"external",
] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];

/** What the registry accepts until #865 designs an approval policy. */
export const SERVED_SIDE_EFFECTS: readonly SideEffect[] = ["none", "read_only"];

/** At most 46 characters and never `__`, which marks a proxied tool. */
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
	sideEffect: SideEffect;
	openWorld: boolean;
	run(input: z.output<S>, ctx: SourceToolContext): Promise<SourceToolResult>;
}

export class SourceToolRefused extends Error {}
