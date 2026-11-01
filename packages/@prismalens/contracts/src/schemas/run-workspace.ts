// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Run workspaces (#925): where a local run's checkout lives, how it is made, and
 * what happens to it after the run. Global settings, overridden per service field by field.
 */
import { z } from "zod";

export const RetentionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("remove-unless-changed") }),
	z.object({ kind: z.literal("always-remove") }),
	z.object({
		kind: z.literal("keep-days"),
		days: z.number().int().min(1).max(365),
	}),
	z.object({ kind: z.literal("keep-until-resolved") }),
]);
export type Retention = z.infer<typeof RetentionSchema>;

const Command = z.string().max(4000);
export const OsCommandsSchema = z.object({
	posix: Command.optional(),
	windows: Command.optional(),
});

const CopyInPathSchema = z
	.string()
	.trim()
	.min(1)
	.max(500)
	.refine(
		(p) =>
			!/^([\\/]|[A-Za-z]:)/.test(p) &&
			!p.split(/[\\/]/).some((s) => s === ".." || s === "." || s === ".git"),
		"A path inside the repository, without '..' or .git",
	);

const LocationSchema = z
	.string()
	.trim()
	.max(1000)
	.refine(
		(p) => /^([\\/]|[A-Za-z]:[\\/]|~[\\/]?)/.test(p),
		"An absolute folder path",
	);

export const RunWorkspaceSettingsSchema = z.object({
	/** Of a local folder, or of the one copy a git URL is cloned into. */
	method: z.enum(["worktree", "clone"]),
	/** Null: `<app data>/worktrees`. */
	location: LocationSchema.nullable(),
	retention: RetentionSchema,
	setup: OsCommandsSchema,
	teardown: OsCommandsSchema,
	copyIn: z.array(CopyInPathSchema).max(50),
	submodules: z.enum(["skip", "top-level", "recursive"]),
	branch: z.enum(["detached", "named"]),
});
export type RunWorkspaceSettings = z.infer<typeof RunWorkspaceSettingsSchema>;

export const DEFAULT_RUN_WORKSPACE_SETTINGS: RunWorkspaceSettings = {
	method: "worktree",
	location: null,
	retention: { kind: "keep-until-resolved" },
	setup: {},
	teardown: {},
	copyIn: [],
	submodules: "skip",
	branch: "detached",
};

/** A service's own fields; an absent one reads "From global settings". */
export const RunWorkspaceOverrideSchema = RunWorkspaceSettingsSchema.partial();
export type RunWorkspaceOverride = z.infer<typeof RunWorkspaceOverrideSchema>;

export const RUN_WORKSPACE_FIELDS = Object.keys(
	RunWorkspaceSettingsSchema.shape,
) as (keyof RunWorkspaceSettings)[];

export const RunWorkspaceGlobalSchema = z.object({
	settings: RunWorkspaceSettingsSchema,
	/** `<app data>/worktrees`, what a null location means. */
	defaultLocation: z.string(),
	/** Where a git URL is cloned once (global only: one copy serves every service). */
	copies: z.object({
		location: LocationSchema.nullable(),
		/** `<app data>/repos`, what a null location means. */
		defaultLocation: z.string(),
		/** Folders named before that still hold a copy a workspace uses. */
		previous: z.array(z.string()),
	}),
	/** Only the host's own session edits these: they run commands on this computer. */
	canEdit: z.boolean(),
});
export type RunWorkspaceGlobal = z.infer<typeof RunWorkspaceGlobalSchema>;

export const UpdateRunWorkspaceCopiesSchema = z.object({
	location: LocationSchema.nullable(),
});

export const ServiceWorkspaceSchema = z.object({
	serviceId: z.string(),
	override: RunWorkspaceOverrideSchema,
	/** What a run of this service gets. */
	effective: RunWorkspaceSettingsSchema,
	/** Fields that read "From global settings". */
	inherited: z.array(z.string()),
	canEdit: z.boolean(),
});
export type ServiceWorkspace = z.infer<typeof ServiceWorkspaceSchema>;

export const UpdateServiceWorkspaceSchema = z.object({
	serviceId: z.string(),
	/** The whole override; a field left out inherits. */
	override: RunWorkspaceOverrideSchema,
});

export const HookResultSchema = z.object({
	status: z.enum(["ok", "failed", "silent", "capped", "aborted"]),
	exitCode: z.number().nullable(),
	output: z.string(),
});

export const WorkspaceRemovalSchema = z.object({
	runId: z.string().nullable(),
	dir: z.string(),
	serviceId: z.string().nullable(),
	removed: z.boolean(),
	reason: z.string(),
	at: z.string(),
	teardown: HookResultSchema.nullable(),
});
export type WorkspaceRemoval = z.infer<typeof WorkspaceRemovalSchema>;

export const WorkspaceRemovalsSchema = z.object({
	removals: z.array(WorkspaceRemovalSchema),
});

export const KeptWorkspaceSchema = z.object({
	dir: z.string(),
	serviceId: z.string().nullable(),
	method: z.enum(["worktree", "clone"]),
	keptAt: z.string(),
	/** Why it is still here: "changed", "keep-days", "keep-until-resolved", ... */
	reason: z.string(),
});
export type KeptWorkspace = z.infer<typeof KeptWorkspaceSchema>;

/** Settings warns about a service holding more kept workspaces than this; nothing removes them for count alone. */
export const KEPT_WORKSPACES_WARN_OVER = 10;

export const ServiceKeptWorkspaceSchema = KeptWorkspaceSchema.extend({
	runId: z.string(),
	serviceId: z.string(),
	serviceName: z.string().nullable(),
});
export type ServiceKeptWorkspace = z.infer<typeof ServiceKeptWorkspaceSchema>;

export const ServiceKeptWorkspacesSchema = z.object({
	workspaces: z.array(ServiceKeptWorkspaceSchema),
	canEdit: z.boolean(),
});

export const RunWorkspacesSchema = z.object({
	workspaces: z.array(KeptWorkspaceSchema),
	canEdit: z.boolean(),
});

export const RunWorkspaceTargetSchema = z.object({
	runId: z.string().uuid(),
	dir: z.string(),
});

export const RemoveWorkspaceResultSchema = z.object({
	removed: z.boolean(),
	reason: z.string(),
});

/** Field by field: the service's own value wins, else the global one (#925). */
export function resolveRunWorkspaceSettings(
	global: RunWorkspaceSettings,
	override: RunWorkspaceOverride = {},
): {
	effective: RunWorkspaceSettings;
	inherited: (keyof RunWorkspaceSettings)[];
} {
	const effective = { ...global };
	const inherited: (keyof RunWorkspaceSettings)[] = [];
	for (const key of RUN_WORKSPACE_FIELDS) {
		const own = override[key];
		if (own === undefined) inherited.push(key);
		else (effective as Record<string, unknown>)[key] = own;
	}
	return { effective, inherited };
}
