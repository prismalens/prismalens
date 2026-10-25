// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One descriptor per source type drives the web connect flow and the
 * probes the api runs (#848, uniform connect UX). Probes are reads only.
 */
import { z } from "zod";
import { PreRunSourceSchema } from "./investigation.js";
import {
	SOURCE_CREDENTIAL_KINDS,
	type SourceCredentialKind,
} from "./source-credential.js";

export const SOURCE_CATEGORIES = [
	"metrics",
	"logs",
	"scm",
	"knowledge",
	"deploys",
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
export const SourceCategorySchema = z.enum(SOURCE_CATEGORIES);

export const SOURCE_CATEGORY_INFO: Record<
	SourceCategory,
	{ label: string; blind: string }
> = {
	metrics: {
		label: "Metrics",
		blind: "Investigations cannot read metrics.",
	},
	logs: { label: "Logs", blind: "Investigations are blind to logs." },
	scm: { label: "Code", blind: "Investigations cannot read the code." },
	knowledge: {
		label: "Knowledge",
		blind: "Investigations have no runbooks to follow.",
	},
	deploys: {
		label: "Deploys",
		blind: "Investigations fall back to the git log for what changed.",
	},
};

/** How a probe's answer is read: a 2xx, an array's length, a label list, a login, or a 5-minute line count. */
export type ProbeRead = "status" | "count" | "labels" | "login" | "volume";

export interface SourceProbe {
	id: string;
	capability: string;
	need: "required" | "optional";
	why: string;
	/** A GET relative to the source URL; `$LABEL` is the discovered service label. */
	path: string;
	read: ProbeRead;
}

export interface SourceTypeDescriptor {
	/** The integration template a connection is saved under. */
	id: string;
	category: SourceCategory;
	vendor: string;
	/** The url-safe word for a vendor within its category. */
	slug: string;
	/** First is the default. */
	credentialKinds: readonly SourceCredentialKind[];
	url: {
		label: string;
		placeholder: string;
		default?: string;
		/** Where the template keeps it: the connection config, or beside the token (GitHub). */
		in: "config" | "credentials";
	};
	/** The template's field for a bearer token, when it predates credential kinds. */
	tokenField?: string;
	detect: { urlEnv?: readonly string[]; tokenEnv?: readonly string[] };
	/** Token scopes the vendor asks for, each with why PrismaLens needs it. */
	scopes?: readonly { key: string; why: string }[];
	probes: readonly SourceProbe[];
	/** The label that names a service; `ask` puts the choice in front of the user. */
	serviceLabel?: { preferred: readonly string[]; ask: boolean };
	/** PrismaLens tools that read it during a run; none for a telemetry source (#848 ruling 2026-10-24). */
	tools: readonly string[];
	/** What the agent does with it when it has no gateway tool. */
	uses?: string;
	docsUrl: string;
}

/** The agent queries a source with its own tools; PrismaLens reads a snapshot before the run (#848 ruling 2026-10-24). */
const PRE_RUN_USE =
	"PrismaLens reads a snapshot of it before each run and hands it to the agent.";

const httpQueryKinds = [
	"none",
	"bearer",
	"basic",
	"header",
	"mtls",
] as const satisfies readonly SourceCredentialKind[];

export const SOURCE_TYPES: readonly SourceTypeDescriptor[] = [
	{
		id: "prometheus",
		category: "metrics",
		vendor: "Prometheus",
		slug: "prometheus",
		credentialKinds: httpQueryKinds,
		url: {
			label: "Prometheus URL",
			placeholder: "http://prometheus.internal:9090",
			in: "config",
		},
		detect: { urlEnv: ["PROMETHEUS_URL"], tokenEnv: ["PROMETHEUS_TOKEN"] },
		probes: [
			{
				id: "query",
				capability: "Run a query",
				need: "required",
				why: "The agent reads metrics around the alert with PromQL.",
				path: "api/v1/query?query=1",
				read: "status",
			},
			{
				id: "labels",
				capability: "Read label names",
				need: "required",
				why: "Finds the label that names a service.",
				path: "api/v1/labels",
				read: "labels",
			},
			{
				id: "alerts",
				capability: "Read firing alerts",
				need: "optional",
				why: "Shows what else fires next to the alert.",
				path: "api/v1/alerts",
				read: "count",
			},
		],
		serviceLabel: { preferred: ["service", "app", "job"], ask: false },
		tools: [],
		uses: PRE_RUN_USE,
		docsUrl: "https://docs.prismalens.io/integrations/prometheus/",
	},
	{
		id: "alertmanager",
		category: "metrics",
		vendor: "Alertmanager",
		slug: "alertmanager",
		credentialKinds: httpQueryKinds,
		url: {
			label: "Alertmanager URL",
			placeholder: "http://alertmanager.internal:9093",
			in: "config",
		},
		detect: { urlEnv: ["ALERTMANAGER_URL"], tokenEnv: ["ALERTMANAGER_TOKEN"] },
		probes: [
			{
				id: "status",
				capability: "Read status",
				need: "required",
				why: "Confirms this is an Alertmanager PrismaLens can read.",
				path: "api/v2/status",
				read: "status",
			},
			{
				id: "alerts",
				capability: "Read alerts",
				need: "required",
				why: "The agent reads which alerts fire together.",
				path: "api/v2/alerts",
				read: "count",
			},
		],
		tools: [],
		uses: PRE_RUN_USE,
		docsUrl: "https://docs.prismalens.io/integrations/alertmanager/",
	},
	{
		id: "loki",
		category: "logs",
		vendor: "Loki",
		slug: "loki",
		credentialKinds: httpQueryKinds,
		url: {
			label: "Loki URL",
			placeholder: "http://loki.internal:3100",
			in: "config",
		},
		detect: { urlEnv: ["LOKI_URL"], tokenEnv: ["LOKI_TOKEN"] },
		probes: [
			{
				id: "labels",
				capability: "Read labels",
				need: "required",
				why: "Finds the label that names a service.",
				path: "loki/api/v1/labels",
				read: "labels",
			},
			{
				id: "query",
				capability: "Query logs",
				need: "required",
				why: "The agent searches the logs around the alert.",
				path: 'loki/api/v1/query?query=sum(count_over_time({$LABEL=~".%2B"}[5m]))',
				read: "volume",
			},
		],
		serviceLabel: {
			preferred: ["service_name", "service", "app", "job"],
			ask: true,
		},
		tools: [],
		uses: PRE_RUN_USE,
		docsUrl: "https://docs.prismalens.io/integrations/loki/",
	},
	{
		id: "github-token",
		category: "scm",
		vendor: "GitHub",
		slug: "github",
		credentialKinds: ["bearer"],
		url: {
			label: "API URL",
			placeholder: "https://api.github.com",
			default: "https://api.github.com",
			in: "credentials",
		},
		tokenField: "apiKey",
		detect: { tokenEnv: ["GITHUB_TOKEN", "GH_TOKEN"] },
		probes: [
			{
				id: "identity",
				capability: "Read the token's user",
				need: "required",
				why: "Confirms whose token this is.",
				path: "user",
				read: "login",
			},
			{
				id: "repos",
				capability: "List repositories",
				need: "required",
				why: "The agent reads the code of the repositories bound to a service.",
				path: "user/repos?per_page=100",
				read: "count",
			},
		],
		tools: [],
		uses: "Clones the repositories bound to a service, read-only, for each run.",
		docsUrl: "https://docs.prismalens.io/integrations/github/",
	},
	{
		id: "gitlab-token",
		category: "scm",
		vendor: "GitLab",
		slug: "gitlab",
		credentialKinds: ["bearer"],
		url: {
			label: "API URL",
			placeholder: "https://gitlab.example.com/api/v4",
			default: "https://gitlab.com/api/v4",
			in: "credentials",
		},
		tokenField: "apiKey",
		detect: { tokenEnv: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN"] },
		scopes: [
			{
				key: "read_api",
				why: "Lists projects and commits, so PrismaLens can match repositories to services and show what changed.",
			},
			{
				key: "read_repository",
				why: "Clones the repositories bound to a service, read-only, for each run.",
			},
		],
		probes: [
			{
				id: "identity",
				capability: "Read the token's user (read_api)",
				need: "required",
				why: "Confirms whose token this is.",
				path: "user",
				read: "login",
			},
			{
				id: "repos",
				capability: "List projects (read_api)",
				need: "required",
				why: "Matches your projects to services.",
				path: "projects?membership=true&per_page=100",
				read: "count",
			},
		],
		tools: [],
		uses: "Clones the repositories bound to a service, read-only, for each run.",
		docsUrl: "https://docs.prismalens.io/integrations/gitlab/",
	},
	{
		id: "bitbucket-token",
		category: "scm",
		vendor: "Bitbucket",
		slug: "bitbucket",
		credentialKinds: ["bearer"],
		url: {
			label: "API URL",
			placeholder: "https://api.bitbucket.org/2.0",
			default: "https://api.bitbucket.org/2.0",
			in: "credentials",
		},
		tokenField: "apiKey",
		detect: { tokenEnv: ["BITBUCKET_TOKEN", "BITBUCKET_ACCESS_TOKEN"] },
		scopes: [
			{
				key: "repository:read",
				why: "Lists repositories and commits, reads files, and clones the repositories bound to a service.",
			},
		],
		probes: [
			{
				id: "repos",
				capability: "List repositories (repository:read)",
				need: "required",
				why: "Matches your repositories to services.",
				path: "repositories?role=member&pagelen=100",
				read: "count",
			},
			{
				id: "identity",
				capability: "Read the token's user",
				need: "optional",
				why: "Shows whose token this is; repository tokens cannot read it.",
				path: "user",
				read: "login",
			},
		],
		tools: [],
		uses: "Clones the repositories bound to a service, read-only, for each run.",
		docsUrl: "https://docs.prismalens.io/integrations/bitbucket/",
	},
];

/** Templates that predate descriptors, with the category the gateway files them under. */
export const TEMPLATE_ONLY_CATEGORY: Readonly<Record<string, SourceCategory>> =
	{ "git-host-token": "scm", render: "deploys" };

export function templateCategory(id: string): SourceCategory | undefined {
	return sourceType(id)?.category ?? TEMPLATE_ONLY_CATEGORY[id];
}

/** A vendor MCP connection's name: it prefixes the tools it offers, so it never holds `__`. */
export const CONNECTION_NAME_MAX = 16;
export const CONNECTION_NAME = /^(?=.{1,16}$)[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** A source PrismaLens reads without a connection: found in what the run already holds. */
export interface BuiltinSourceDescriptor {
	id: string;
	category: SourceCategory;
	label: string;
	steps: readonly ConnectStep[];
	tools: readonly string[];
	docsUrl: string;
}

export const BUILTIN_SOURCES: readonly BuiltinSourceDescriptor[] = [
	{
		id: "runbooks",
		category: "knowledge",
		label: "Runbooks in your repos",
		steps: ["toggle", "confirm"],
		tools: ["runbooks_list", "runbooks_read"],
		docsUrl: "https://docs.prismalens.io/integrations/runbooks/",
	},
];

/** Knowledge bases teams keep runbooks in that PrismaLens cannot read yet. */
export const UNSUPPORTED_KNOWLEDGE_VENDORS = ["Confluence", "Notion"] as const;

/** Git hosts PrismaLens cannot read the API of yet. */
export const UNSUPPORTED_SCM_VENDORS = [
	"Gitea",
	"Forgejo",
	"Azure DevOps",
] as const;

export function sourceType(id: string): SourceTypeDescriptor | undefined {
	return SOURCE_TYPES.find((t) => t.id === id);
}

export function sourceTypeBySlug(
	category: string,
	slug: string,
): SourceTypeDescriptor | undefined {
	return SOURCE_TYPES.find((t) => t.category === category && t.slug === slug);
}

/**
 * The user actions from "connect <category>" to working: pick the vendor (a detected one
 * sorts first), submit the auth form or "use detected" (test and discover run on submit),
 * choose a discovered value when the descriptor asks, confirm.
 */
export type ConnectStep = "pick" | "auth" | "choose" | "confirm" | "toggle";
export function connectSteps(
	d: SourceTypeDescriptor | BuiltinSourceDescriptor,
): ConnectStep[] {
	if ("steps" in d) return [...d.steps];
	return [
		"pick",
		"auth",
		...(d.serviceLabel?.ask ? ["choose" as const] : []),
		"confirm",
	];
}

/** The operator's per-category step budget for #848. */
export const CONNECT_STEP_BUDGET: Record<SourceCategory, number> = {
	metrics: 4,
	logs: 4,
	scm: 3,
	knowledge: 2,
	deploys: 3,
};

// =============================================================================
// API shapes
// =============================================================================

/** `removed`: a connection the run saw that no longer exists (#848, OBJ-010). */
export const SourceStatusSchema = z.enum([
	"connected",
	"unreachable",
	"not-configured",
	"removed",
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceCategoryViewSchema = z.object({
	category: SourceCategorySchema,
	status: SourceStatusSchema,
	sources: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			kind: z.string(),
			status: SourceStatusSchema,
			/** Items the source holds, when it counts them (runbooks found for the run). */
			count: z.number().int().optional(),
			lastErrorAt: z.string().optional(),
			reason: z.string().optional(),
			/** A vendor MCP connection's name and the user's one-line description. */
			name: z.string().optional(),
			description: z.string().optional(),
			/** Tools offered this run, and what the discovery bounds left out. */
			toolCount: z.number().int().optional(),
			dropped: z
				.array(
					z.object({
						count: z.number().int(),
						why: z.enum([
							"tool-count",
							"schema-bytes",
							"total-tools",
							"total-bytes",
							"received-bytes",
						]),
					}),
				)
				.optional(),
		}),
	),
	tools: z.array(z.string()),
	howToConnect: z.string().optional(),
});
export type SourceCategoryView = z.infer<typeof SourceCategoryViewSchema>;

export const RunbooksToggleSchema = z.object({ enabled: z.boolean() });

export const DetectedSourceSchema = z.object({
	type: z.string(),
	/** The variable it was found in; its value is never sent when it is a token. */
	env: z.string(),
	url: z.string().optional(),
});
export type DetectedSource = z.infer<typeof DetectedSourceSchema>;

/** Templates the alert pull reads, so one connection is also an Alert intake source. */
export const ALERT_PULL_TEMPLATES: readonly string[] = [
	"prometheus",
	"alertmanager",
];

/** What a row's state word is built from; the UI shows words only (#848, gap 2). */
export const SourceProblemSchema = z.enum([
	"credential-refused",
	"cant-reach",
	"needs-credential",
]);
export type SourceProblem = z.infer<typeof SourceProblemSchema>;

/** One telemetry connection on Settings, Sources (#848 C17). */
export const SourceRowSchema = z.object({
	connectionId: z.string(),
	label: z.string(),
	kind: z.string(),
	/** The stored URL, for display only. */
	address: z.string().nullable(),
	status: z.string(),
	/** The last Test that passed; null reads "Not tested yet". */
	testedAt: z.string().nullable(),
	/** `env` only when nothing is stored and a same-origin env token exists. */
	credential: z.enum(["stored", "env", "none"]),
	credentialKind: z.enum(SOURCE_CREDENTIAL_KINDS).optional(),
	/** The env token a stored credential wins over, same origin only. */
	overridesEnv: z.string().optional(),
	problem: SourceProblemSchema.nullable(),
	/** The message behind a problem, shown in the row's details. */
	lastErrorMessage: z.string().nullable(),
	usedBy: z.array(z.object({ serviceId: z.string(), name: z.string() })),
	alsoInAlertIntake: z.boolean(),
});
export type SourceRow = z.infer<typeof SourceRowSchema>;

const hasUserinfo = (value: string): boolean => {
	try {
		const u = new URL(value);
		return !!u.username || !!u.password;
	} catch {
		return false;
	}
};

export const SourceDraftSchema = z.object({
	type: z.string(),
	/** No `user:pass@`: a credential goes in `credential`, not the address (#848). */
	url: z
		.string()
		.trim()
		.url()
		.refine((u) => !hasUserinfo(u), {
			message:
				"Credentials in the address are not supported; choose how to sign in below.",
		}),
	/** `{ kind, ...fields }` as `CREDENTIAL_KIND_FIELDS` names them. */
	credential: z.record(z.string(), z.string()).optional(),
	/** Take the token or URL from the variable the api detected. */
	useDetected: z.boolean().optional(),
	serviceLabel: z.string().trim().min(1).optional(),
	label: z.string().trim().min(1).optional(),
	/** A vendor MCP connection's name (`CONNECTION_NAME`) and one-line description. */
	name: z.string().trim().optional(),
	description: z.string().trim().min(1).max(80).optional(),
	/** The advanced scope override for a sign-in. */
	scopes: z.array(z.string().trim().min(1)).optional(),
	/** `connect` saves without a probe, so the row reads "Not tested yet" (#848). */
	saveUntested: z.boolean().optional(),
});
export type SourceDraft = z.infer<typeof SourceDraftSchema>;

export const ProbeResultSchema = z.object({
	id: z.string(),
	capability: z.string(),
	need: z.enum(["required", "optional"]),
	why: z.string(),
	ok: z.boolean(),
	/** What it found, or why it failed, in PrismaLens's words. */
	detail: z.string(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const ProbeReportSchema = z.object({
	type: z.string(),
	/** The only host the credential is sent to. */
	host: z.string(),
	ok: z.boolean(),
	probes: z.array(ProbeResultSchema),
	discovered: z.object({
		labels: z.array(z.string()).optional(),
		serviceLabel: z.string().nullable().optional(),
		identity: z.string().optional(),
	}),
	/** A git token with no repository on its host to try: neither passed nor failed. */
	untested: z.boolean().optional(),
});
export type ProbeReport = z.infer<typeof ProbeReportSchema>;

/** `connectionId` is null when a required probe failed and nothing was saved. */
export const ConnectSourceResponseSchema = z.object({
	connectionId: z.string().nullable(),
	report: ProbeReportSchema,
});

const GitHostRepoSchema = z.object({
	repositoryId: z.string(),
	url: z.string(),
});

/** `GET /sources/git-hosts`: one git host's credentials, in the order a repository tries them (#848, ADR 0007 §6). */
export const GitHostViewSchema = z.object({
	host: z.string(),
	/** The steps that apply on this host, in the order they are tried. */
	order: z.array(z.enum(["pin", "stored", "env", "machine"])),
	stored: z.array(
		z.object({
			connectionId: z.string(),
			label: z.string(),
			fingerprint: z.string(),
			status: z.string(),
			testedAt: z.string().nullable(),
			pinnedRepos: z.array(GitHostRepoSchema),
		}),
	),
	env: z.object({ variable: z.string(), fingerprint: z.string() }).nullable(),
	machine: z.object({ helper: z.string() }).nullable(),
	/** Two or more stored tokens and at least one repository that pins none. */
	ambiguous: z.boolean(),
	/** The repositories on this host that pin no token; the "Pick a token" remedy pins them. */
	unpinnedRepos: z.array(GitHostRepoSchema),
});
export type GitHostView = z.infer<typeof GitHostViewSchema>;

/** `GET /sources`: the telemetry connections and the git hosts (#848 C17). */
export const SourcesOverviewSchema = z.object({
	sources: z.array(SourceRowSchema),
	gitHosts: z.array(GitHostViewSchema),
});
export type SourcesOverview = z.infer<typeof SourcesOverviewSchema>;

export const SourcesPreRunInputSchema = z.object({
	serviceId: z.string(),
	/** The deployment to preview; the untagged and other-tag rules apply without one. */
	deployment: z.string().trim().max(64).optional(),
});

/** A unit a service's runs would read: the snapshot's source fields, before anything is read. */
export const PreRunUnitSchema = PreRunSourceSchema.omit({
	status: true,
	detail: true,
	file: true,
	excerpt: true,
	truncated: true,
});

/** `GET /sources/pre-run`: the run's own resolver for one service and deployment (#848). */
export const SourcesPreRunSchema = z.object({
	kinds: z.array(
		z.object({
			kind: PreRunSourceSchema.shape.kind,
			units: z.array(PreRunUnitSchema),
			notConfigured: z.boolean(),
			/** Why nothing is read for this kind, e.g. several connections and none mapped. */
			skipped: z.string().nullable(),
			/** The env pseudo-connection: its variable, its URL's origin, and whether its token is set. */
			envFallback: z
				.object({
					variable: z.string(),
					origin: z.string(),
					tokenSet: z.boolean(),
				})
				.nullable(),
		}),
	),
	deploymentsSeen: z.array(z.string()),
});
export type SourcesPreRun = z.infer<typeof SourcesPreRunSchema>;
