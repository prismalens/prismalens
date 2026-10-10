// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incident schemas
 */
import {
	HARNESS_IDS,
	HARNESS_SELECTION_FAILURES,
} from "@prismalens/config/harness";
import { z } from "zod";
import { AlertSchema } from "./alert.js";
import {
	CoerceDateSchema,
	DateStringSchema,
	IncidentStatusSchema,
	PrioritySchema,
	QueryBooleanSchema,
	RootCauseCategorySchema,
	SeveritySchema,
} from "./common.js";
import {
	AttachmentIdsSchema,
	AttachmentRefSchema,
	RunChoiceSchema,
} from "./investigation.js";
import { ServiceSchema } from "./service.js";
import {
	INVESTIGATION_KINDS,
	LIVE_TURNS,
	TURN_OUTCOMES,
} from "./state-semantics.js";

// =============================================================================
// INCIDENT SCHEMAS
// =============================================================================

export const IncidentSchema = z.object({
	id: z.string().uuid(),
	number: z.number().int(),
	title: z.string().min(1),
	description: z.string().nullable(),
	severity: SeveritySchema,
	status: IncidentStatusSchema,
	priority: PrioritySchema,
	serviceId: z.string().uuid().nullable(),
	assignedToId: z.string().uuid().nullable(),
	correlationReason: z.string().nullable(),
	tags: z.array(z.string()).nullable(),
	customerImpact: z.string().nullable(),
	/** What the responder recorded as the real cause on close (#338); outranks the investigation's guess in similarity. */
	actualCause: z.string().nullable(),
	actualCauseCategory: RootCauseCategorySchema.nullable(),
	affectedSystems: z.array(z.string()).nullable(),
	triggeredAt: DateStringSchema,
	acknowledgedAt: DateStringSchema.nullable(),
	resolvedAt: DateStringSchema.nullable(),
	alertCount: z.number().int(),
	timeToAcknowledge: z.number().int().nullable(),
	timeToResolve: z.number().int().nullable(),
	/** When the operator last reopened it, or the source refired it inside the flap window (R1a d4). */
	reopenedAt: DateStringSchema.nullable().optional(),
	reopenReason: z.enum(["flap", "operator"]).nullable().optional(),
	/** The operator's Resolve; `resolvedAt` stays when the alerts cleared. */
	closedAt: DateStringSchema.nullable().optional(),
	/** Seconds from the first alert to the operator's Resolve. */
	timeToClose: z.number().int().nullable().optional(),
	/** The ended incident whose alert fired again as this one (R1a d5). */
	priorIncidentId: z.string().uuid().nullable().optional(),
	/** The incident this one's alerts were merged into; it ended then (#673 w37). */
	mergedIntoId: z.string().uuid().nullable().optional(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateIncidentSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	priority: PrioritySchema.optional(),
	/** Matches the incident's own service or any of its alerts' services. */
	serviceId: z.string().uuid().optional(),
	tags: z.array(z.string()).optional(),
	customerImpact: z.string().optional(),
	affectedSystems: z.array(z.string()).optional(),
});

/** The longest cause a responder can record; the Resolve dialog counts against it. */
export const ACTUAL_CAUSE_MAX = 2000;

/** Closing records what actually happened, when the responder knows (#338). */
export const CloseIncidentSchema = z.object({
	id: z.string().uuid(),
	actualCause: z.string().trim().max(ACTUAL_CAUSE_MAX).optional(),
	actualCauseCategory: RootCauseCategorySchema.optional(),
});
export type CloseIncidentInput = z.infer<typeof CloseIncidentSchema>;

/** Every alert on `id` moves to `targetId`, and `id` ends (#673 w37). */
export const MergeIncidentSchema = z.object({
	id: z.string().uuid(),
	targetId: z.string().uuid(),
});
export type MergeIncidentInput = z.infer<typeof MergeIncidentSchema>;

export const UpdateIncidentSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	severity: SeveritySchema.optional(),
	status: IncidentStatusSchema.optional(),
	priority: PrioritySchema.optional(),
	assignedToId: z.string().uuid().optional(),
	customerImpact: z.string().optional(),
	tags: z.array(z.string()).optional(),
	/** Editable after Resolve (R1a d3); an empty string clears it. */
	actualCause: z.string().trim().max(ACTUAL_CAUSE_MAX).optional(),
	actualCauseCategory: RootCauseCategorySchema.nullable().optional(),
});

// =============================================================================
// INCIDENT WITH RELATIONS
// =============================================================================

// User reference
const UserRefSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
});

// Investigation reference (minimal to avoid circular)
const InvestigationRefSchema = z.object({
	id: z.string().uuid(),
	status: z.string(),
	/** A run is a thread (#673); the run tabs read these without a second route. */
	kind: z.enum(INVESTIGATION_KINDS).optional().default("investigation"),
	agentMode: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	startedAt: DateStringSchema.nullable().optional(),
	hasReport: z.boolean().optional(),
	// Rendered by IncidentDetailPanel — omitting it here strips the field at
	// the oRPC output boundary even though the service selects it.
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable().optional(),
	/** Why the run failed, for the list's headline (#743). */
	error: z.string().nullable().optional(),
	harness: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
	stopRequestedAt: DateStringSchema.nullable().optional(),
	liveTurn: z.enum(LIVE_TURNS).nullable().optional(),
	lastTurnOutcome: z.enum(TURN_OUTCOMES).nullable().optional(),
	/** Set while the run's agent waits on an Approve or Deny (#673 w21). */
	awaitingApprovalAt: DateStringSchema.nullable().optional(),
	/** Latest run only: when its last event landed, and its latest agent sentence while live. */
	lastEventAt: DateStringSchema.nullable().optional(),
	latestText: z.string().nullable().optional(),
	/** Latest completed run only: evidence rows behind its top hypothesis. */
	evidenceCount: z.number().int().nullable().optional(),
	createdAt: DateStringSchema,
	completedAt: DateStringSchema.nullable(),
});

/** A service an incident touches: its own, or one of its alerts' (#743). */
export const IncidentServiceRefSchema = z.object({
	id: z.string(),
	name: z.string(),
	displayName: z.string().nullable(),
});
export type IncidentServiceRef = z.infer<typeof IncidentServiceRefSchema>;

export const IncidentWithRelationsSchema = IncidentSchema.extend({
	service: ServiceSchema.nullable().optional(),
	assignedTo: UserRefSchema.nullable().optional(),
	alerts: z.array(AlertSchema).optional(),
	investigations: z.array(InvestigationRefSchema).optional(),
	/** Every service the incident touches, its own first. */
	services: z.array(IncidentServiceRefSchema).optional(),
	/** The ended incident this one fired again after (R1a d5). */
	priorIncident: z
		.object({
			number: z.number().int(),
			status: IncidentStatusSchema,
			actualCause: z.string().nullable(),
		})
		.nullable()
		.optional(),
	/** The newest incident that names this one as its prior. */
	refiredAs: z
		.object({
			id: z.string().uuid(),
			number: z.number().int(),
			createdAt: DateStringSchema,
		})
		.nullable()
		.optional(),
	/** The incident `mergedIntoId` names. */
	mergedInto: z
		.object({ id: z.string().uuid(), number: z.number().int() })
		.nullable()
		.optional(),
});

// =============================================================================
// INCIDENT QUERY SCHEMAS
// =============================================================================

export const IncidentQuerySchema = z.object({
	status: IncidentStatusSchema.optional(),
	/** Only incidents still wanting work (OPEN_INCIDENT_STATUSES); ignored when `status` is set. */
	open: QueryBooleanSchema.optional(),
	severity: SeveritySchema.optional(),
	priority: PrioritySchema.optional(),
	serviceId: z.string().uuid().optional(),
	fromDate: CoerceDateSchema.optional(),
	toDate: CoerceDateSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

export const IncidentStatsQuerySchema = IncidentQuerySchema.pick({
	serviceId: true,
	fromDate: true,
	toDate: true,
});

/** Counts over the whole window, never over one page of the list. */
export const IncidentStatsSchema = z.object({
	total: z.number().int(),
	open: z.number().int(),
	byStatus: z.record(z.string(), z.number().int()),
	bySeverity: z.record(z.string(), z.number().int()),
	attention: z.object({
		awaiting_approval: z.number().int(),
		failed_run: z.number().int(),
		unacknowledged: z.number().int(),
		reopened: z.number().int(),
		awaiting_close: z.number().int(),
	}),
	/** Mean timeToResolve in seconds over ended incidents that recorded one; null when none did. */
	avgTimeToResolve: z.number().nullable(),
});

// =============================================================================
// INCIDENT ACTIONS
// =============================================================================

/** Optional operator brief, appended to the agent's first prompt (#743). */
export const InvestigateIncidentSchema = z.object({
	brief: z.string().trim().max(4000).optional(),
	/** The agent's own mode id (#673 w21); the agent's default when absent. */
	agentMode: z.string().max(64).optional(),
	...RunChoiceSchema.shape,
	/** Uploaded with `POST /incidents/{id}/attachments` first (R4.3). */
	attachments: AttachmentIdsSchema.optional(),
});

/** A person's message that starts a chat run on the incident (#673). */
export const ChatIncidentSchema = z.object({
	text: z.string().trim().min(1).max(4000),
	agentMode: z.string().max(64).optional(),
	...RunChoiceSchema.shape,
	attachments: AttachmentIdsSchema.optional(),
});

/** What the box accepts (R4.3): images to 4 MB, text files to 256 KB. */
export const ATTACHMENT_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;
export const ATTACHMENT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TEXT_MAX_BYTES = 256 * 1024;
export const ATTACHMENT_TEXT_EXTENSIONS = [
	".log",
	".json",
	".csv",
	".md",
	".txt",
	".yaml",
	".yml",
] as const;

/** An image, a text file, or null when the box refuses it (pure, so the box and the API agree). */
export function attachmentKind(file: {
	name: string;
	type: string;
}): "image" | "text" | null {
	if ((ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(file.type))
		return "image";
	if (file.type.startsWith("text/")) return "text";
	const name = file.name.toLowerCase();
	return ATTACHMENT_TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
		? "text"
		: null;
}

export const UploadAttachmentSchema = z.object({
	id: z.string().uuid(),
	file: z.file(),
});

export const AttachmentSchema = AttachmentRefSchema.extend({
	incidentId: z.string().uuid(),
	sha256: z.string(),
	createdAt: DateStringSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const GetAttachmentSchema = z.object({
	id: z.string().uuid(),
	attachmentId: z.string().uuid(),
});
export type InvestigateIncidentInput = z.infer<
	typeof InvestigateIncidentSchema
>;

export const InvestigateIncidentResponseSchema = z.object({
	incidentId: z.string().uuid(),
	investigationId: z.string().uuid(),
	jobId: z.string().nullable(),
	queued: z.boolean(),
});

// =============================================================================
// INVESTIGATION REFUSAL (ADR-0031, #520)
// =============================================================================

/**
 * Derived from the config package's list rather than restated, so a code the
 * selection logic can emit can never be missing here. The previous hand-written
 * enum had drifted to the point of sharing exactly one member with it: it still
 * advertised four codes from the retired LLM-provider model and omitted both
 * codes a bare machine actually returns.
 */
export const HarnessSelectionFailureSchema = z.enum(HARNESS_SELECTION_FAILURES);

export const InvestigationRefusalSchema = z.object({
	failure: HarnessSelectionFailureSchema,
	reason: z.string(),
	harness: z.enum(HARNESS_IDS).optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Incident = z.infer<typeof IncidentSchema>;
export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;
export type IncidentWithRelations = z.infer<typeof IncidentWithRelationsSchema>;
export type IncidentQuery = z.infer<typeof IncidentQuerySchema>;
export type InvestigateIncidentResponse = z.infer<
	typeof InvestigateIncidentResponseSchema
>;
export type HarnessSelectionFailure = z.infer<
	typeof HarnessSelectionFailureSchema
>;
export type InvestigationRefusal = z.infer<typeof InvestigationRefusalSchema>;
export type IncidentStats = z.infer<typeof IncidentStatsSchema>;
export type IncidentStatsQuery = z.infer<typeof IncidentStatsQuerySchema>;
