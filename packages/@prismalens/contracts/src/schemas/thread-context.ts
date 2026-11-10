// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a thread's right panel shows (#1024, surface D): one payload per kind of
 * thread, the typed targets prose links open, project scripts and editors.
 */
import { z } from "zod";
import { IncidentStatusSchema, SeveritySchema } from "./common.js";
import {
	AgentPlanSchema,
	HelperPlaceSchema,
	RecordedHypothesisSchema,
} from "./investigation.js";
import { PullRequestSchema } from "./pull-request.js";
import { RecurrenceSchema } from "./schedule.js";

export const ProjectScriptSchema = z.object({
	/** npm | pnpm | yarn | bun for package.json, else make or just. */
	runner: z.enum(["npm", "pnpm", "yarn", "bun", "make", "just"]),
	name: z.string(),
	/** What a terminal would run, e.g. `pnpm run test`; nothing runs it without a click. */
	command: z.string(),
});
export type ProjectScript = z.infer<typeof ProjectScriptSchema>;
export const ProjectScriptsSchema = z.object({
	scripts: z.array(ProjectScriptSchema),
});

const ContextRepoSchema = z.object({
	name: z.string(),
	branch: z.string().nullable(),
	head: z.string(),
	/** Live changes against `head`; null when they could not be read. */
	additions: z.number().int().nonnegative().nullable(),
	deletions: z.number().int().nonnegative().nullable(),
});

export const ThreadLineageRunSchema = z.object({
	id: z.string(),
	kind: z.enum(["investigation", "chat"]),
	harness: z.string().nullable(),
	model: z.string().nullable(),
	status: z.string(),
	/** answered | stopped | error for a follow-up, else the run's own end. */
	outcome: z.string().nullable(),
	at: z.string(),
});

const ContextBaseShape = {
	threadId: z.string(),
	title: z.string().nullable(),
	machine: z.object({
		hostName: z.string(),
		os: z.enum(["windows", "macos", "linux", "other"]),
		/** The viewer is the computer PrismaLens runs on: host-only actions show. */
		isHost: z.boolean(),
	}),
	agent: z.object({
		harness: z.string().nullable(),
		model: z.string().nullable(),
		effort: z.string().nullable(),
	}),
	workspace: z
		.object({
			layout: z.enum(["unmapped", "single", "multi", "folder", "in_place"]),
			cwd: z.string(),
			repos: z.array(ContextRepoSchema),
			/** A kept worktree of this thread's own the panel may discard; never the user's checkout. */
			kept: z.array(z.object({ dir: z.string() })),
		})
		.nullable(),
	lineage: z.array(ThreadLineageRunSchema),
	plan: AgentPlanSchema.nullable(),
	/** Every kind may find one in the agent's text; a project also finds one from its branch. */
	pullRequests: z.array(PullRequestSchema),
};

export const ThreadContextSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("project"),
		...ContextBaseShape,
		project: z.object({ id: z.string(), name: z.string() }),
		scripts: z.array(ProjectScriptSchema),
	}),
	z.object({
		kind: z.literal("incident"),
		...ContextBaseShape,
		incident: z.object({
			id: z.string(),
			number: z.number().int(),
			title: z.string(),
			severity: SeveritySchema,
			status: IncidentStatusSchema,
			alertCount: z.number().int(),
			impact: z.string().nullable(),
		}),
		suspects: z.array(
			RecordedHypothesisSchema.pick({
				id: true,
				statement: true,
				status: true,
			}),
		),
		report: z.enum(["none", "running", "ready", "failed"]),
	}),
	z.object({
		kind: z.literal("service"),
		...ContextBaseShape,
		service: z.object({
			id: z.string(),
			name: z.string(),
			tier: z.string(),
			owner: z.string().nullable(),
			dependencies: z.array(z.object({ id: z.string(), name: z.string() })),
		}),
	}),
	z.object({
		kind: z.literal("schedule"),
		...ContextBaseShape,
		schedule: z.object({
			id: z.string(),
			name: z.string(),
			recurrence: RecurrenceSchema.nullable(),
			nextRunAt: z.string().nullable(),
			lastRuns: z
				.array(
					z.object({
						id: z.string(),
						status: z.string(),
						at: z.string(),
					}),
				)
				.max(5),
		}),
	}),
	z.object({
		kind: z.literal("none"),
		...ContextBaseShape,
		helperPlace: HelperPlaceSchema.nullable(),
	}),
]);
export type ThreadContext = z.infer<typeof ThreadContextSchema>;
export type ThreadContextKind = ThreadContext["kind"];

/** What a prose link opens (#1024 decision 4); only targets that exist come back. */
export const LinkTargetSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("file"),
		repo: z.string(),
		/** The commit the run recorded; empty for a folder run, whose file is the live one. */
		sha: z.string(),
		path: z.string(),
		line: z.number().int().positive().optional(),
		end: z.number().int().positive().optional(),
	}),
	z.object({ type: z.literal("diff"), path: z.string() }),
	z.object({ type: z.literal("url"), href: z.string().url() }),
	z.object({ type: z.literal("pull_request"), pullRequest: PullRequestSchema }),
	z.object({
		type: z.literal("thread"),
		id: z.string(),
		/** Threads have no number yet; `#` and links find them by id. */
		number: z.number().int().nullable(),
		title: z.string().nullable(),
		state: z.string(),
	}),
	z.object({
		type: z.literal("incident"),
		id: z.string(),
		number: z.number().int(),
	}),
	z.object({ type: z.literal("artifact"), id: z.string(), title: z.string() }),
	/** Reserved for in-session sub-agents (surface B). */
	z.object({
		type: z.literal("subagent"),
		sessionId: z.string(),
		title: z.string(),
	}),
]);
export type LinkTarget = z.infer<typeof LinkTargetSchema>;

export const LINK_CANDIDATE_KINDS = [
	"path",
	"url",
	"thread",
	"incident",
	"artifact",
	"subagent",
] as const;
export const LinkCandidateSchema = z.object({
	kind: z.enum(LINK_CANDIDATE_KINDS),
	/** The text as the agent wrote it: `src/a.ts:12-20`, a URL, `#42`, a thread id, an artifact title. */
	text: z.string().min(1).max(2000),
});
export type LinkCandidate = z.infer<typeof LinkCandidateSchema>;
export const RESOLVE_LINKS_MAX = 200;

export const ResolveLinksSchema = z.object({
	id: z.string().uuid(),
	candidates: z.array(LinkCandidateSchema).max(RESOLVE_LINKS_MAX),
});
export const ResolvedLinksSchema = z.object({
	/** Same order as the candidates; null where nothing exists to open. */
	targets: z.array(LinkTargetSchema.nullable()),
});
export type ResolvedLinks = z.infer<typeof ResolvedLinksSchema>;

export const EDITOR_IDS = [
	"vscode",
	"cursor",
	"zed",
	"jetbrains",
	"sublime",
] as const;
export const EditorIdSchema = z.enum(EDITOR_IDS);
export type EditorId = z.infer<typeof EditorIdSchema>;
export const EditorSchema = z.object({
	id: EditorIdSchema,
	label: z.string(),
	/** The executable found on PATH. */
	command: z.string(),
});
export type Editor = z.infer<typeof EditorSchema>;
export const EditorsSchema = z.object({ editors: z.array(EditorSchema) });

export const OpenInEditorSchema = z.object({
	/** The run whose workspace holds the file. */
	id: z.string().uuid(),
	/** Relative to the workspace's cwd; absent opens the cwd. */
	path: z.string().max(1000).optional(),
	line: z.number().int().positive().optional(),
	/** Absent uses Settings → "Open files in". */
	editor: z.union([EditorIdSchema, z.literal("system")]).optional(),
});
export const OpenInEditorResultSchema = z.object({
	opened: z.boolean(),
	editor: z.union([EditorIdSchema, z.literal("system")]),
});

/** Settings rows: Sources → "Show pull request status", General → "Open files in". */
export const ThreadContextSettingsSchema = z.object({
	prStatus: z.boolean(),
	editor: z.union([EditorIdSchema, z.literal("system")]),
});
export type ThreadContextSettings = z.infer<typeof ThreadContextSettingsSchema>;
export const DEFAULT_THREAD_CONTEXT_SETTINGS: ThreadContextSettings = {
	prStatus: true,
	editor: "system",
};
