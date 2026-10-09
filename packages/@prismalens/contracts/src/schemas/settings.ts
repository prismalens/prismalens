// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings schemas: harness detection, investigation policy, danger zone, MCP.
 */

import { HARNESS_IDS, SANDBOX_STATES } from "@prismalens/config/harness";
import { z } from "zod";

// =============================================================================
// HARNESS (detect and report, ADR 0003 §9)
// =============================================================================

/** Harness setting: "auto" or an explicit harness ID. PRISMALENS_HARNESS overrides. */
export const HarnessSettingSchema = z.enum(["auto", ...HARNESS_IDS]);
export type HarnessSetting = z.infer<typeof HarnessSettingSchema>;

/** One registry row as the doctor and the settings card show it. */
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

/** A starred model, across agents (T3's star tile; R4.2). */
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
		})
		.nullable(),
	/** One-line install hint, shown when not installed. */
	install: z.string(),
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: z.string().nullable(),
	/** The agent's own mode a run asks for when Settings names none; `agent-default` asks for none (#673 w21). */
	defaultMode: z.string().default("agent-default"),
	/** How the Model setting reaches this harness: ACP `session/set_config_option`, or not at all (R4.2). */
	modelVia: z.enum(["acp", "unsupported"]),
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: z.string(),
	/** The model the host env names for this harness; a run with no model set uses it (walk f18). Absent from older APIs. */
	envModel: z
		.object({ key: z.string(), model: z.string() })
		.nullable()
		.default(null),
	/** Under WSL, a Windows install on PATH that cannot run here (#673 w8). Absent from older APIs. */
	windowsOnlyPath: z.string().nullable().default(null),
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
			/** The check's one line, as `pl doctor` prints it. */
			detail: z.string(),
			/** The model it reported as current: "Agent default" names this, never a PrismaLens choice. */
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
const AgentModeIdSchema = z.string().min(1).max(64);
const CustomModelsSchema = z.array(ModelIdSchema).max(50);

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
	/** The agent's own mode id per harness; a harness without one uses its row default (#673 w21). */
	agentModes: z
		.partialRecord(z.enum(HARNESS_IDS), AgentModeIdSchema)
		.optional(),
	/** Model ids the operator added per agent, shown in the picker beside the agent's own list (#673 w57). */
	customModels: z
		.partialRecord(z.enum(HARNESS_IDS), CustomModelsSchema)
		.optional(),
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
		/** Merges per harness; `null` goes back to the row default. */
		agentModes: z
			.partialRecord(z.enum(HARNESS_IDS), AgentModeIdSchema.nullable())
			.optional(),
		/** Replaces that agent's list; `null` clears it. */
		customModels: z
			.partialRecord(z.enum(HARNESS_IDS), CustomModelsSchema.nullable())
			.optional(),
	})
	.strict();
export type UpdateHarnessSettings = z.infer<typeof UpdateHarnessSettingsSchema>;

export const HarnessesResponseSchema = z.object({
	harnesses: z.array(HarnessStatusSchema),
	selection: HarnessSelectionStatusSchema,
});
export type HarnessesResponse = z.infer<typeof HarnessesResponseSchema>;

/** `pl doctor`'s ACP handshake, on demand from the Settings Harness tab (#630, Unit D on #337). */
export const CheckHarnessInputSchema = z.object({
	id: z.enum(HARNESS_IDS),
});
export type CheckHarnessInput = z.infer<typeof CheckHarnessInputSchema>;

/** `initialize` + `session/new`, no prompt turn. Four outcomes; `detail` is the words `pl doctor` prints too, one line. */
export const HarnessProbeResultSchema = z.object({
	id: z.enum(HARNESS_IDS),
	outcome: HarnessProbeOutcomeSchema,
	detail: z.string(),
	hard: z.literal(false),
	/** The models the harness itself offers (ACP `configOptions`, category `model`); these win over the catalogue. */
	models: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
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
	}),
	upgradeCommand: z.string(),
	uninstallCommand: z.string(),
});
export type About = z.infer<typeof AboutSchema>;

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
