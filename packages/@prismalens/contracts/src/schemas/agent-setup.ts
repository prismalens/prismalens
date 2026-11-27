// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What loads into each agent, and the one PrismaLens set beside its own (#1180 §3.1, §3.3). */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

export const LOADED_KINDS = [
	"instructions",
	"plugin",
	"skill",
	"mcp",
	"hook",
] as const;
export const LOADED_STATES = [
	"found",
	"loads",
	"in-project",
	"off",
	"untrusted",
	"failed",
	"unknown",
	"not-sent",
] as const;

export const LoadedItemSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		kind: z.enum(LOADED_KINDS),
		name: z.string().min(1).max(200),
		scope: z.enum(["global", "repo", "plugin", "prismalens", "managed"]),
		path: z.string().max(1024).nullable(),
		/** Found on disk now. */
		disk: z.boolean(),
		/** When a matching session last reported it. */
		reported: z.string().datetime().nullable(),
		state: z.enum(LOADED_STATES),
		via: z.string().max(40).optional(),
		/** MCP: never a command, argument, URL, env or header value. */
		transport: z.enum(["stdio", "http", "sse"]).optional(),
		/** PrismaLens items: how it reaches the agent. */
		layer: z.enum(["system", "first-message", "config"]).optional(),
		/** Why a PrismaLens item was not sent, as the row shows it. */
		note: z.string().max(80).optional(),
	}),
);
export type LoadedItem = z.infer<typeof LoadedItemSchema>;

export const LoadoutProfileSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["own", "clean"]),
);
export type LoadoutProfile = z.infer<typeof LoadoutProfileSchema>;

export const AgentLoadoutSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agent: z.string(),
		repositoryId: z.string().nullable(),
		profile: LoadoutProfileSchema,
		readAt: z.string().datetime(),
		/** False when PrismaLens has no layout for this agent: every group shows `Not readable for this agent`. */
		readable: z.boolean(),
		/** The session the reported items came from; null when none matched this agent, project and profile. */
		report: z
			.object({ at: z.string().datetime(), threadId: z.string() })
			.nullable(),
		/** The newest run of this agent and project whose setup differs from today's. */
		staleReport: z
			.object({ at: z.string().datetime(), threadId: z.string() })
			.nullable(),
		items: z.array(LoadedItemSchema).max(500),
	}),
);
export type AgentLoadout = z.infer<typeof AgentLoadoutSchema>;

export const AgentLoadoutInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().min(1).max(64),
		repositoryId: z.string().min(1).max(64).optional(),
		profile: LoadoutProfileSchema.optional(),
	}),
);
export type AgentLoadoutInput = z.infer<typeof AgentLoadoutInputSchema>;

// ---------------------------------------------------------------- shared set

/** An env, header, argument or query name a value is stored under. */
export const SharedValueNameSchema = /* @__PURE__ */ lazySchema(() =>
	z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/),
);
export const SharedServerNameSchema = /* @__PURE__ */ lazySchema(() =>
	z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
);

export const SharedMcpDefSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("type", [
		// The command absolute; an argument the person marked secret is `{ value: name }`.
		z.object({
			type: z.literal("stdio"),
			command: z.string().min(1).max(1024),
			args: z
				.array(
					z.union([
						z.string().max(1024),
						z.object({ value: SharedValueNameSchema }),
					]),
				)
				.max(64),
			/** Env var names whose values are stored values. */
			env: z.array(SharedValueNameSchema).max(32).default([]),
		}),
		// Origin and path only: no userinfo, query or fragment; a marked query part is a value.
		z.object({
			type: z.literal("http"),
			url: z.string().url().max(2048),
			query: z.array(SharedValueNameSchema).max(16),
			/** Header names whose values are stored values. */
			headers: z.array(SharedValueNameSchema).max(32).default([]),
		}),
	]),
);
export type SharedMcpDef = z.infer<typeof SharedMcpDefSchema>;

/** Stored only encrypted; never returned whole by any route. */
export const SharedMcpServerStoredSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: SharedServerNameSchema,
		def: SharedMcpDefSchema,
		/** The resolved command and every absolute file argument, hashed at approval. */
		files: z
			.array(z.object({ path: z.string().max(1024), sha256: z.string() }))
			.max(65),
		values: z.record(SharedValueNameSchema, z.string().max(8192)),
		/** sha256 of def, files and value names, set at approval. */
		hash: z.string(),
		/** The hash the values were entered for. */
		valuesFor: z.string().nullable(),
		/** Agent ids the person approved. */
		recipients: z.array(z.string()),
		from: z
			.object({
				agent: z.string(),
				path: z.string().max(1024),
				key: z.string().max(200),
				sourceHash: z.string(),
			})
			.nullable(),
	}),
);
export type SharedMcpServerStored = z.infer<typeof SharedMcpServerStoredSchema>;

export const SharedMcpServerViewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: z.string(),
		transport: z.enum(["stdio", "http"]),
		/** Basename only, stdio. */
		command: z.string().nullable(),
		argCount: z.number().int(),
		/** Host only, http. */
		host: z.string().nullable(),
		valueNames: z.array(z.string()),
		missingValues: z.array(z.string()),
		recipients: z.array(z.string()),
		changedInSource: z.boolean(),
		/** The source agent, for `Changed in <agent>`. */
		fromAgent: z.string().nullable(),
		/** The agent config entry it was copied from, so Copy again opens on that entry. */
		fromSource: SharedSourceSchema.nullable(),
	}),
);
export type SharedMcpServerView = z.infer<typeof SharedMcpServerViewSchema>;

export const SharedSetSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		decided: z.enum(["as-is", "shared"]).nullable(),
		/** The person's own PrismaLens text. */
		instructions: z.string().max(32768),
		/** Agent ids the instructions reach. */
		instructionsFor: z.array(z.string()),
		/** Changes on every instructions edit; recorded per session. */
		revision: z.string(),
		servers: z.array(SharedMcpServerViewSchema).max(32),
	}),
);
export type SharedSet = z.infer<typeof SharedSetSchema>;

export const ApproveSharedServerInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		name: SharedServerNameSchema,
		def: SharedMcpDefSchema,
		values: z.record(SharedValueNameSchema, z.string().max(8192)),
		recipients: z.array(z.string().min(1).max(64)).max(32),
		/** The agent config entry the form was pre-filled from. */
		from: z
			.object({
				agent: z.string().min(1).max(64),
				path: z.string().max(1024),
				key: z.string().min(1).max(200),
				/** The preview's `revision`. */
				revision: z.string().max(128),
			})
			.nullable()
			.default(null),
	}),
);
export type ApproveSharedServerInput = z.infer<
	typeof ApproveSharedServerInputSchema
>;

export const UpdateSharedSetInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		decided: z.enum(["as-is", "shared"]).optional(),
		instructions: z.string().max(32768).optional(),
		instructionsFor: z.array(z.string().min(1).max(64)).max(32).optional(),
	}),
);
export type UpdateSharedSetInput = z.infer<typeof UpdateSharedSetInputSchema>;

/** `agent.useSharedSet`: one agent's membership in every server and the instructions. */
export const SetSharedMembershipInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().min(1).max(64), member: z.boolean() }),
);

/** A user-scope MCP entry in an agent's own config, as a share can start from. */
export const SharedSourceSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agent: z.string().min(1).max(64),
		path: z.string().max(1024),
		key: z.string().min(1).max(200),
	}),
);
export type SharedSource = z.infer<typeof SharedSourceSchema>;

/** Every argument and the URL path masked; env and header names only (§3.3). */
export const SharedServerPreviewSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		source: SharedSourceSchema,
		transport: z.enum(["stdio", "http"]),
		command: z.string().nullable(),
		/** One entry per argument, `null` until revealed. */
		args: z.array(z.null()),
		origin: z.string().nullable(),
		hasPath: z.boolean(),
		/** URL parts parsing removed, as `Removed from the URL:` names them. */
		removed: z.array(z.enum(["sign-in", "query", "fragment"])),
		env: z.array(z.string()),
		headers: z.array(z.string()),
		/** The source entry's hash as previewed; reveal and approval refuse a source that changed since. */
		revision: z.string().max(128),
	}),
);
export type SharedServerPreview = z.infer<typeof SharedServerPreviewSchema>;

export const RevealSharedRowInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		source: SharedSourceSchema,
		/** An argument's index, or `path` for the URL path. */
		row: z.union([z.number().int().min(0).max(63), z.literal("path")]),
		revision: z.string().max(128),
	}),
);
export type RevealSharedRowInput = z.infer<typeof RevealSharedRowInputSchema>;

/** What one session reported loading (`agent_loadout`, one per session): the event's payload. */
export const AgentLoadoutReportSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		profile: LoadoutProfileSchema,
		cwd: z.string().max(1024),
		/** `configFingerprint` at session open; a view merges only a report whose fingerprint equals its own. */
		fingerprint: z.string(),
		items: z.array(LoadedItemSchema).max(500),
	}),
);
export type AgentLoadoutReport = z.infer<typeof AgentLoadoutReportSchema>;
