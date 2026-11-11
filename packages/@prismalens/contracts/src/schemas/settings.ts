// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings schemas: harness detection, investigation policy, danger zone, MCP.
 */

import {
	ACCESS_LEVELS,
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	HARNESS_IDS,
	type HarnessId,
	SANDBOX_STATES,
} from "@prismalens/config/harness";
import { z } from "zod";
import { SubagentLimitSchema } from "./subagents.js";

// =============================================================================
// PERMISSION LEVEL (#673 w21 ruling 2026-10-10)
// =============================================================================

export const AccessLevelSchema = z.enum(ACCESS_LEVELS);

/**
 * The agent's own permission default, read from the user's settings file.
 * Null: no file or no key; a null level: a value with no PrismaLens
 * equivalent, or with `reason`, one that cannot run here.
 */
export const LocalDefaultSchema = z.object({
	permission: z
		.object({
			level: AccessLevelSchema.nullable(),
			file: z.string(),
			value: z.string(),
			reason: z.string().optional(),
		})
		.nullable(),
});
export type LocalDefault = z.infer<typeof LocalDefaultSchema>;

/** Where a run's level came from, for the default row's tag. */
export type AxisSource = "settings" | "agent" | "prismalens";

type AxisSettings<K extends string, V> = Partial<
	Record<K, Partial<Record<HarnessId, V>> | undefined>
>;

/**
 * A run an alert starts has nobody to answer an ask: the agent runs its Auto mode and
 * PrismaLens refuses whatever it still asks, as headless agent runs do (#818 w5-29).
 */
export const AUTO_START_ACCESS_LEVEL: AccessLevel = "auto";

/** An alert-started run: Auto. A run you start: Settings, then the agent's own default, then PrismaLens's. */
export function effectiveAccess(
	s: AxisSettings<"accessLevels", AccessLevel>,
	harness: HarnessId,
	local: LocalDefault["permission"] | undefined,
	autoStart = false,
): { level: AccessLevel; from: AxisSource } {
	if (autoStart) return { level: AUTO_START_ACCESS_LEVEL, from: "prismalens" };
	const set = s.accessLevels?.[harness];
	if (set) return { level: set, from: "settings" };
	if (local?.level) return { level: local.level, from: "agent" };
	return { level: DEFAULT_ACCESS_LEVEL, from: "prismalens" };
}

// =============================================================================
// HARNESS (detect and report, ADR 0003 §9)
// =============================================================================

/** Harness setting: "auto" or an explicit harness ID. PRISMALENS_HARNESS overrides. */
export const HarnessSettingSchema = z.enum(["auto", ...HARNESS_IDS]);
export type HarnessSetting = z.infer<typeof HarnessSettingSchema>;

/** One registry row as the Settings agent card shows it. */
/** A harness's `thought_level` option over ACP, with its own default (R4.2). */
export const EffortOptionSchema = z.object({
	id: z.string(),
	values: z.array(z.string()),
	default: z.string().nullable(),
});
export type EffortOption = z.infer<typeof EffortOptionSchema>;

/** A permission mode as the agent's own ACP list names it (#673 w21). */
export const AgentModeOptionSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
});
export type AgentModeOption = z.infer<typeof AgentModeOptionSchema>;

/** Whether the agent's own OS sandbox holds a mode on this machine, and what the check saw (#673 w51). */
export const SandboxCheckSchema = z.object({
	state: z.enum(SANDBOX_STATES),
	reason: z.string(),
});
export type SandboxCheck = z.infer<typeof SandboxCheckSchema>;

/** By mode id, `agent-default` included; null until a check ran. */
const SandboxChecksSchema = z.record(z.string(), SandboxCheckSchema);

/** One value of the agent's `thought_level` option, with its own name; `default` marks the agent's current one. */
export const EffortLevelSchema = z.object({
	id: z.string(),
	name: z.string(),
	default: z.boolean(),
});
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

/** A starred model, across agents (R4.2). */
export const FavouriteModelSchema = z.object({
	harness: z.enum(HARNESS_IDS),
	model: z.string().min(1).max(200),
});
export type FavouriteModel = z.infer<typeof FavouriteModelSchema>;

/** A readiness check's verdict; only `answers-acp` is a pass. */
export const HarnessProbeOutcomeSchema = z.enum([
	"answers-acp",
	"sign-in-needed",
	"no-answer",
	"failed-to-start",
]);
export type HarnessProbeOutcome = z.infer<typeof HarnessProbeOutcomeSchema>;

/** An env var name, POSIX-style (#907). */
export const EnvNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
/**
 * `set`: stored in PrismaLens, wins over the host. `env`: inherited from the
 * environment PrismaLens runs with. `unset`: neither (#907).
 */
export const ENV_VAR_STATES = ["unset", "set", "env"] as const;
export const AgentEnvVarSchema = z.object({
	name: EnvNameSchema,
	state: z.enum(ENV_VAR_STATES),
	/** `set` and the host has it too, so the stored value overrides it (#911; Sources' `overridesEnv`). */
	inEnv: z.boolean().default(false),
});
export type AgentEnvVar = z.infer<typeof AgentEnvVarSchema>;

export const HarnessStatusSchema = z.object({
	id: z.string(),
	label: z.string(),
	binary: z.string(),
	installed: z.boolean(),
	/** The version a compatibility run passed on; null when none has run. */
	tested: z
		.object({
			version: z.string(),
			date: z.string(),
			/** The agent CLI the adapter drove in that run (#818). */
			companion: z.string().optional(),
		})
		.nullable(),
	/** One-line install hint, shown when not installed. */
	install: z.string(),
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: z.string().nullable(),
	/** The agent's own permission default, from the user's settings file (#673 w21). */
	localDefault: LocalDefaultSchema.default({ permission: null }),
	/** How the Model setting reaches this harness: ACP `session/set_config_option`, or not at all (R4.2). */
	modelVia: z.enum(["acp", "unsupported"]),
	/** One line the picker and the Settings check show: how to sign this harness in. */
	loginHint: z.string(),
	/** The model the host env names for this harness; a run with no model set uses it (walk f18). Absent from older APIs. */
	envModel: z
		.object({ key: z.string(), model: z.string() })
		.nullable()
		.default(null),
	/** Under WSL, a Windows install on PATH that cannot run here (#673 w8). Absent from older APIs. */
	windowsOnlyPath: z.string().nullable().default(null),
	/** It starts here and its last check, if any, answered (#907). Only these are listed and pickable. */
	runnable: z.boolean().default(false),
	/** The program Binary path names: the agent's own CLI, not its adapter; empty for the local agent. */
	cliBinary: z.string().default(""),
	/** Provider key names the agent reads; Add agent's sign-in step offers them (#907). */
	providerKeys: z.array(z.string()).default([]),
	/** Its variables by name and state, never a value (#907). Absent from older APIs. */
	envVars: z.array(AgentEnvVarSchema).default([]),
	/** The env var Config directory sets, and what unset means; null when the agent has none. */
	configDir: z
		.object({ envKey: z.string(), shownDefault: z.string() })
		.nullable()
		.default(null),
	/** What the run view says when PrismaLens's tools did not reach this agent (#848). */
	toolsHint: z.object({ text: z.string() }).optional(),
	/**
	 * Models to suggest (#639). `harness`: the list the harness itself offered at
	 * its last readiness check, which wins. `catalogue`: prismalens's model
	 * catalogue as of `asOf`. Suggestions only; any id is accepted as typed.
	 */
	models: z.object({
		source: z.enum(["harness", "catalogue"]),
		asOf: z.string(),
		entries: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				status: z.string().nullable(),
				/** The agent's own line for the entry; a `default` entry's names the model it runs (#907). */
				description: z.string().optional(),
			}),
		),
	}),
	/**
	 * What the last readiness check read from the harness itself (R4.2 d4,
	 * R4.3 d2); null until one has run, which the picker says as "pending a check".
	 * Every outcome is kept; only `answers-acp` lets a run start (#673 w9).
	 */
	checked: z
		.object({
			at: z.string(),
			outcome: HarnessProbeOutcomeSchema,
			/** The check's one line, as Settings shows it. */
			detail: z.string(),
			/** The version the agent reported; null when it reported none (#818 w5-31). */
			version: z.string().nullable().default(null),
			/** The agent CLI's own version behind a shipped adapter, from `--version` (#818). */
			companionVersion: z.string().nullable().default(null),
			/** The model it reported as current: the agent's own model row names this, never a PrismaLens choice. */
			servedModel: z.string().nullable(),
			effort: EffortOptionSchema.nullable(),
			/** The agent's own permission modes; null when it advertised none. */
			modes: z.array(AgentModeOptionSchema).nullable().default(null),
			/** The effort levels the agent offered, by name; null when it offered none. */
			efforts: z.array(EffortLevelSchema).nullable().default(null),
			images: z.boolean(),
			sandbox: SandboxChecksSchema.nullable().default(null),
		})
		.nullable()
		.optional(),
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

/** Would an investigation start right now? The gate's own words, never rewritten. */
export const HarnessSelectionStatusSchema = z.object({
	runnable: z.boolean(),
	harness: z.string().nullable(),
	/** Pinned rather than auto-selected, by PRISMALENS_HARNESS or by Settings → Agent. */
	pinned: z.boolean(),
	pinnedBy: z.enum(["env", "settings"]).nullable(),
	blockedReason: z.string().nullable(),
});
export type HarnessSelectionStatus = z.infer<
	typeof HarnessSelectionStatusSchema
>;

const ModelIdSchema = z.string().min(1).max(200);
const EffortValueSchema = z.string().min(1).max(64);
const CustomModelsSchema = z.array(ModelIdSchema).max(50);
const PathSchema = z.string().trim().min(1).max(1024);
const ModelListSchema = z.array(ModelIdSchema).max(500);
/** The one local ACP agent: a command and its arguments, no shell (#907). */
export const LocalAgentSchema = z.object({
	command: PathSchema,
	args: z.array(z.string().max(1024)).max(32),
});
export type LocalAgent = z.infer<typeof LocalAgentSchema>;
/** The refusal a paired device gets for a runtime field (#907). */
export const RUNTIME_HOST_ONLY =
	"Only the owner can change what an agent runs.";

/** Context tokens above which a long-idle thread asks before it sends (#1024). */
export const COLD_RESUME_TOKENS = 50_000;

/**
 * Persisted harness choice; PRISMALENS_HARNESS wins over it. The model is
 * stored per harness (#639): an id is in one harness's own format, so a model
 * set for one never reaches another.
 */
export const HarnessSettingsSchema = z.object({
	harness: HarnessSettingSchema,
	/** Model id per harness; a harness without one uses its default. */
	models: z.partialRecord(z.enum(HARNESS_IDS), ModelIdSchema).optional(),
	favourites: z.array(FavouriteModelSchema).optional(),
	/** Effort per harness, one of the values its `thought_level` option offers (R4.2). */
	efforts: z.partialRecord(z.enum(HARNESS_IDS), EffortValueSchema).optional(),
	/** Permission level per agent for the next run; unset follows the agent's own default (#673 w21). */
	accessLevels: z
		.partialRecord(z.enum(HARNESS_IDS), AccessLevelSchema)
		.optional(),
	/** Model ids the operator added per agent, shown in the picker beside the agent's own list (#673 w57). */
	customModels: z
		.partialRecord(z.enum(HARNESS_IDS), CustomModelsSchema)
		.optional(),
	/** Models left out of the picker per agent; a model the agent adds later shows (#907). */
	hiddenModels: z
		.partialRecord(z.enum(HARNESS_IDS), ModelListSchema)
		.optional(),
	/** The operator's model order per agent; ids it doesn't name follow in the agent's order. */
	modelOrder: z.partialRecord(z.enum(HARNESS_IDS), ModelListSchema).optional(),
	/** The agent's own program, absolute; empty uses PATH. */
	binaryPaths: z.partialRecord(z.enum(HARNESS_IDS), PathSchema).optional(),
	/** The folder the agent's config-dir env var points at. */
	configDirs: z.partialRecord(z.enum(HARNESS_IDS), PathSchema).optional(),
	localAgent: LocalAgentSchema.optional(),
	/** Only pass named variables: the agent gets an allowlist, not the user's environment (#817). */
	strictEnv: z.boolean().optional(),
	/** Alert and schedule runs keep the user's GitHub token (#1020, R41); absent is off. */
	unattendedGithub: z.boolean().optional(),
	/** When an alert-started run asks (#1020): absent is `decide`, refuse at once. */
	alertAsks: z.enum(["decide", "wait"]).optional(),
	/** Runs a restart cut off carry on when PrismaLens starts again (#981); absent is on. */
	resumeAfterRestart: z.boolean().optional(),
	/** A long-idle thread with a large context (#1024): ask first (absent), compact first, or send as is. */
	coldResume: z.enum(["ask", "compact", "send"]).optional(),
	/** Only ask above this many context tokens; absent is 50,000. */
	coldResumeTokens: z.number().int().min(0).max(10_000_000).optional(),
	/** A usage limit schedules a resume at its reset (#1024); absent is on. */
	resumeAfterLimit: z.boolean().optional(),
	/** Compact idle threads before their agent's cache expires (#1024); absent is off. */
	compactIdle: z.boolean().optional(),
	/** Names of the variables set per agent; values are never read back. */
	envNames: z
		.partialRecord(z.enum(HARNESS_IDS), z.array(EnvNameSchema))
		.optional(),
	/** In-session sub-agents (#1024 spec B): unset is the agent's own default. */
	subagentDepth: SubagentLimitSchema.optional(),
	subagentConcurrency: SubagentLimitSchema.optional(),
	/** False on a paired device: runtime fields are the host's alone. */
	canEditRuntime: z.boolean().optional(),
});
export type HarnessSettings = z.infer<typeof HarnessSettingsSchema>;

/** A patch: `models` merges per harness, and `null` clears that harness's model. */
export const UpdateHarnessSettingsSchema = z
	.object({
		harness: HarnessSettingSchema.optional(),
		models: z
			.partialRecord(z.enum(HARNESS_IDS), ModelIdSchema.nullable())
			.optional(),
		/** Replaces the whole list. */
		favourites: z.array(FavouriteModelSchema).max(100).optional(),
		/** Merges per harness; `null` goes back to the harness's own default. */
		efforts: z
			.partialRecord(z.enum(HARNESS_IDS), EffortValueSchema.nullable())
			.optional(),
		/** Each merges per harness; `null` goes back to the default. */
		accessLevels: z
			.partialRecord(z.enum(HARNESS_IDS), AccessLevelSchema.nullable())
			.optional(),
		/** Replaces that agent's list; `null` clears it. */
		customModels: z
			.partialRecord(z.enum(HARNESS_IDS), CustomModelsSchema.nullable())
			.optional(),
		/** Each replaces that agent's list; `null` clears it. */
		hiddenModels: z
			.partialRecord(z.enum(HARNESS_IDS), ModelListSchema.nullable())
			.optional(),
		modelOrder: z
			.partialRecord(z.enum(HARNESS_IDS), ModelListSchema.nullable())
			.optional(),
		/** Each merges per agent; `null` clears. Host only. */
		binaryPaths: z
			.partialRecord(z.enum(HARNESS_IDS), PathSchema.nullable())
			.optional(),
		configDirs: z
			.partialRecord(z.enum(HARNESS_IDS), PathSchema.nullable())
			.optional(),
		/** Merges per agent and name; a `null` value removes the name. Host only. */
		env: z
			.partialRecord(
				z.enum(HARNESS_IDS),
				z.record(EnvNameSchema, z.string().max(8192).nullable()),
			)
			.optional(),
		/** `null` removes the local agent. Host only. */
		localAgent: LocalAgentSchema.nullable().optional(),
		/** Only pass named variables (#817). Host only. */
		strictEnv: z.boolean().optional(),
		/** Alert and schedule runs keep the GitHub token (#1020). Host only. */
		unattendedGithub: z.boolean().optional(),
		/** When an alert-started run asks (#1020). Host only. */
		alertAsks: z.enum(["decide", "wait"]).optional(),
		/** Resume runs a restart cut off (#981). Host only. */
		resumeAfterRestart: z.boolean().optional(),
		/** A long-idle thread with a large context (#1024): ask first (absent), compact first, or send as is. */
		coldResume: z.enum(["ask", "compact", "send"]).optional(),
		/** Only ask above this many context tokens; absent is 50,000. */
		coldResumeTokens: z.number().int().min(0).max(10_000_000).optional(),
		/** A usage limit schedules a resume at its reset (#1024); absent is on. */
		resumeAfterLimit: z.boolean().optional(),
		/** Compact idle threads before their agent's cache expires (#1024); absent is off. */
		compactIdle: z.boolean().optional(),
		/** `null` goes back to the agent's own default. Host only. */
		subagentDepth: SubagentLimitSchema.nullable().optional(),
		subagentConcurrency: SubagentLimitSchema.nullable().optional(),
	})
	.strict();
export type UpdateHarnessSettings = z.infer<typeof UpdateHarnessSettingsSchema>;

export const HarnessesResponseSchema = z.object({
	harnesses: z.array(HarnessStatusSchema),
	selection: HarnessSelectionStatusSchema,
});
export type HarnessesResponse = z.infer<typeof HarnessesResponseSchema>;

/** The readiness check's ACP handshake, on demand from Settings → Agent (#630, Unit D on #337). */
export const CheckHarnessInputSchema = z.object({
	id: z.enum(HARNESS_IDS),
});
export type CheckHarnessInput = z.infer<typeof CheckHarnessInputSchema>;

/** `initialize` + `session/new`, no prompt turn. Four outcomes; `detail` is the words Settings shows, one line. */
export const HarnessProbeResultSchema = z.object({
	id: z.enum(HARNESS_IDS),
	outcome: HarnessProbeOutcomeSchema,
	detail: z.string(),
	hard: z.literal(false),
	version: z.string().nullable().optional(),
	companionVersion: z.string().nullable().optional(),
	/** The models the harness itself offers (ACP `configOptions`, category `model`); these win over the catalogue. */
	models: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				description: z.string().optional(),
			}),
		)
		.optional(),
	servedModel: z.string().nullable().optional(),
	effort: EffortOptionSchema.nullable().optional(),
	modes: z.array(AgentModeOptionSchema).nullable().optional(),
	efforts: z.array(EffortLevelSchema).nullable().optional(),
	images: z.boolean().optional(),
	sandbox: SandboxChecksSchema.nullable().optional(),
});
export type HarnessProbeResult = z.infer<typeof HarnessProbeResultSchema>;

// =============================================================================
// INVESTIGATION POLICIES
// =============================================================================

/**
 * Per-service auto-investigation policy, stored under the service's
 * `metadata.investigation.trigger` and read by the API's trigger service when an
 * alert lands on an incident. A service without one uses the default.
 */
export const TriggerPolicySchema = z.enum([
	"always",
	"critical_and_high",
	"critical_only",
	"never",
]);
export type TriggerPolicy = z.infer<typeof TriggerPolicySchema>;
export const DEFAULT_TRIGGER_POLICY: TriggerPolicy = "critical_and_high";

// =============================================================================
// INVESTIGATION TRIGGERS
// =============================================================================

/**
 * Investigation trigger types - how investigations can be started
 */
export const InvestigationTriggerTypeSchema = z.enum([
	"manual", // User clicks "Investigate" button
	"auto_critical", // Auto-triggered for critical severity
	"auto_tier", // Auto-triggered based on service tier
	"alert_threshold", // Auto-triggered when alert count exceeds threshold
	"scheduled", // Auto-triggered for stale incidents
	"re_trigger", // A refire reopened the incident (#673 w25)
]);
export type InvestigationTriggerType = z.infer<
	typeof InvestigationTriggerTypeSchema
>;

/**
 * Update strategy for alerts arriving during investigation
 */
export const InvestigationUpdateStrategySchema = z.enum([
	"ignore", // Don't notify - investigation proceeds
	"notify", // Add to pendingAlerts for Commander awareness
	"queue_partial", // Queue partial re-analysis after completion
	"restart", // Cancel and restart investigation
]);
export type InvestigationUpdateStrategy = z.infer<
	typeof InvestigationUpdateStrategySchema
>;

// =============================================================================
// DANGER ZONE
// =============================================================================

export const ResetDataInputSchema = z.object({
	confirmation: z.literal("RESET"),
});
export type ResetDataInput = z.infer<typeof ResetDataInputSchema>;

export const FactoryResetInputSchema = z.object({
	confirmation: z.literal("FACTORY RESET"),
});
export type FactoryResetInput = z.infer<typeof FactoryResetInputSchema>;

export const DangerOperationResultSchema = z.object({
	success: z.boolean(),
	message: z.string().optional(),
});
export type DangerOperationResult = z.infer<typeof DangerOperationResultSchema>;

import { type MCPServerId, mcpServerIdSchema } from "@prismalens/config/mcp";

/**
 * MCP server ID schema - re-exported from @prismalens/config
 */
export const McpServerIdSchema = mcpServerIdSchema;
export type McpServerId = MCPServerId;

/**
 * Per-server MCP configuration stored in DB
 * Note: Credentials come from IntegrationContext, not stored here
 */
export const McpServerSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	readOnlyMode: z.boolean().default(true),
	toolFilter: z.array(z.string()).optional(),
	// Custom transport overrides (optional - uses defaults if not set)
	customHttpUrl: z.string().url().optional(),
	customDockerImage: z.string().optional(),
});
export type McpServerSettings = z.infer<typeof McpServerSettingsSchema>;

/**
 * Full MCP settings structure stored in DB
 */
export const McpSettingsSchema = z.object({
	servers: z.partialRecord(McpServerIdSchema, McpServerSettingsSchema),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

/**
 * Update MCP settings input (partial update)
 */
export const UpdateMcpSettingsSchema = z.object({
	servers: z
		.partialRecord(McpServerIdSchema, McpServerSettingsSchema.partial())
		.optional(),
});
export type UpdateMcpSettings = z.infer<typeof UpdateMcpSettingsSchema>;

/**
 * MCP server status (runtime state)
 */
export const McpServerStatusSchema = z.object({
	serverId: McpServerIdSchema,
	enabled: z.boolean(),
	readOnlyMode: z.boolean(),
	hasCredentials: z.boolean(),
	isReady: z.boolean(), // enabled && hasCredentials
	integrationType: z.string(),
	toolFilter: z.array(z.string()).optional(),
});
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

/**
 * Full MCP status response
 */
export const McpStatusResponseSchema = z.object({
	servers: z.array(McpServerStatusSchema),
});
export type McpStatusResponse = z.infer<typeof McpStatusResponseSchema>;

/**
 * Test MCP connection input
 */
export const TestMcpConnectionInputSchema = z.object({
	serverId: McpServerIdSchema,
});
export type TestMcpConnectionInput = z.infer<
	typeof TestMcpConnectionInputSchema
>;

/**
 * Test MCP connection result
 */
export const TestMcpResultSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	toolCount: z.number().optional(),
});
export type TestMcpResult = z.infer<typeof TestMcpResultSchema>;

/**
 * Product telemetry, on after a notice (#673 w45). `noticed`: the notice was
 * displayed somewhere; `dismissed`: OK or Turn off was pressed on it.
 * `forcedOff` means PRISMALENS_TELEMETRY=off (`pl up --telemetry=off`) wins.
 */
export const TelemetrySettingsSchema = z.object({
	enabled: z.boolean(),
	forcedOff: z.boolean(),
	noticed: z.boolean(),
	dismissed: z.boolean(),
	recentlySent: z.array(
		z.object({
			payload: z.record(z.string(), z.unknown()),
		}),
	),
});
export type TelemetrySettings = z.infer<typeof TelemetrySettingsSchema>;

/** "When an update is ready" on About (#1024 E): notify, or install once idle. */
export const UpdateAutoInstallSchema = z.enum(["notify", "idle"]);
export type UpdateAutoInstall = z.infer<typeof UpdateAutoInstallSchema>;

export const UPDATE_INSTALL_BLOCKERS = [
	"not_installer",
	"not_host",
	"busy",
	"disabled",
] as const;
export const UpdateInstallAvailabilitySchema = z.object({
	available: z.boolean(),
	blockedBy: z.enum(UPDATE_INSTALL_BLOCKERS).optional(),
});
export type UpdateInstallAvailability = z.infer<
	typeof UpdateInstallAvailabilitySchema
>;

/** The release channel an install follows (#1024); nightly is npm-only. */
export const UpdateChannelSchema = z.enum(["stable", "nightly"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

/**
 * Settings → About (#717): what this copy is, whether a newer release is out,
 * and the commands to upgrade or uninstall it the way it was installed.
 */
export const AboutSchema = z.object({
	version: z.string(),
	channel: z.enum(["npm", "installer", "homebrew", "scoop", "electron"]),
	build: z.string().nullable(),
	workspaceDir: z.string(),
	/** Newest `prismalens.db.bak-*` in the workspace, made before a migration. */
	latestBackup: z.string().nullable(),
	update: z.object({
		/** Newest release with its downloads attached, or null when unknown. */
		latest: z.string().nullable(),
		available: z.boolean(),
		checkedAt: z.string().nullable(),
		/** The variable that turned the check off, or null when it runs. */
		disabledBy: z.enum(["PRISMALENS_UPDATE_CHECK", "DO_NOT_TRACK"]).nullable(),
		releaseNotesUrl: z.string().nullable(),
		/** The release's own notes as sanitised Markdown, or null until fetched (#1024 E). */
		notes: z.string().nullable().optional(),
		publishedAt: z.string().nullable().optional(),
		/** Whether this caller may Install and restart now, and if not, why (#724). */
		install: UpdateInstallAvailabilitySchema.optional(),
	}),
	upgradeCommand: z.string(),
	uninstallCommand: z.string(),
	logsDir: z.string().optional(),
	runtime: z
		.object({ node: z.string(), os: z.string(), arch: z.string() })
		.optional(),
	autoInstall: UpdateAutoInstallSchema.optional(),
	/** "Check for updates" on About; the env switches in `disabledBy` still win. */
	checkForUpdates: z.boolean().optional(),
	updateChannel: z
		.object({
			/** The channel the check follows now. */
			current: UpdateChannelSchema,
			/** Set when `PRISMALENS_UPDATE_CHANNEL` decides it; About then can't change it. */
			fromEnv: z.boolean(),
			/** Why this copy can't follow nightly, or null when it can. */
			nightlyBlockedBy: z.enum(["not_npm"]).nullable(),
			/** On stable while running a nightly that no stable has overtaken: why it waits. */
			leavingNightly: z.string().nullable(),
			/** This copy is a nightly build, whatever channel is saved. */
			nightlyBuild: z.boolean(),
		})
		.optional(),
});
export type About = z.infer<typeof AboutSchema>;

/** One `pl doctor` check, run in the API for About's diagnostics (#932). */
export const DoctorCheckSchema = z.object({
	id: z.string(),
	label: z.string(),
	status: z.enum(["ok", "warn", "fail"]),
	detail: z.string(),
	fix: z.string().optional(),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DiagnosticsSchema = z.object({
	checks: z.array(DoctorCheckSchema),
	ranAt: z.string(),
});
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;

export const UPDATE_INSTALL_PHASES = [
	"idle",
	"downloading",
	"verifying",
	"installing",
	"restarting",
	"failed",
	"done",
] as const;

/** Where an Install and restart stands (#724); polled while the card shows progress. */
export const UpdateInstallStatusSchema = z.object({
	phase: z.enum(UPDATE_INSTALL_PHASES),
	/** The version being installed, or this copy's own version when idle. */
	version: z.string(),
	error: z.string().optional(),
	upgradeCommand: z.string(),
	/** Dispatch claims nothing new; queued work starts after the restart. */
	draining: z.boolean(),
});
export type UpdateInstallStatus = z.infer<typeof UpdateInstallStatusSchema>;

export const UpdatePrefsSchema = z.object({
	autoInstall: UpdateAutoInstallSchema.optional(),
	checkForUpdates: z.boolean().optional(),
	/** Saved to the workspace, where `pl upgrade` reads it too. */
	channel: UpdateChannelSchema.optional(),
});
export type UpdatePrefs = z.infer<typeof UpdatePrefsSchema>;

export const InstallUpdateInputSchema = z.object({
	/** The version the card offered; refused when the check now says otherwise. */
	version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export const UpdateTelemetrySettingsSchema = z.object({
	enabled: z.boolean().optional(),
	/** The notice was displayed; sending starts on the next boot. */
	noticed: z.literal(true).optional(),
	/** OK or Turn off was pressed on the notice. */
	dismissed: z.literal(true).optional(),
});
export type UpdateTelemetrySettings = z.infer<
	typeof UpdateTelemetrySettingsSchema
>;

/**
 * Where a finished report is posted (#606, ADR 0008 §1: a Slack incoming webhook
 * first). The URL is a secret; it is stored encrypted and never read back.
 */
export const ReportDeliverySettingsSchema = z.object({
	slackConfigured: z.boolean(),
});
export type ReportDeliverySettings = z.infer<
	typeof ReportDeliverySettingsSchema
>;

/** Only Slack's own webhook hosts, so the setting cannot point the server anywhere else. */
export const SLACK_WEBHOOK_URL =
	/^https:\/\/hooks\.slack(-gov)?\.com\/services\/[A-Za-z0-9/_-]+$/;

export const UpdateReportDeliverySchema = z.object({
	/** null removes the webhook. */
	slackWebhookUrl: z
		.string()
		.trim()
		.regex(
			SLACK_WEBHOOK_URL,
			"Must be a https://hooks.slack.com/services/… URL",
		)
		.nullable(),
});
export type UpdateReportDelivery = z.infer<typeof UpdateReportDeliverySchema>;
