// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Case File schemas (experiment, behind Setting `case_file`): alert-time capture
 * against a bound Kubernetes target, and the claims a case is built from.
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// VOCABULARIES
// =============================================================================

export const CLAIM_STATUSES = [
	"hint",
	"candidate",
	"observed",
	"inferred",
	"stated",
	"confirmed",
	"inconclusive",
	"unknown",
] as const;
export const ClaimStatusSchema = z.enum(CLAIM_STATUSES);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** Who ran the command a claim rests on. */
export const COMMAND_PROVENANCE = [
	"host-executed",
	"shim-observed",
	"harness-relayed",
	"harness-reported",
] as const;
export const CommandProvenanceSchema = z.enum(COMMAND_PROVENANCE);
export type CommandProvenance = z.infer<typeof CommandProvenanceSchema>;

export const RETRIEVALS = ["complete", "partial"] as const;
export const RetrievalSchema = z.enum(RETRIEVALS);
export type Retrieval = z.infer<typeof RetrievalSchema>;

export const RETRIEVAL_REASONS = [
	"page-limit",
	"byte-cap",
	"timeout",
	"error",
] as const;
export const RetrievalReasonSchema = z.enum(RETRIEVAL_REASONS);
export type RetrievalReason = z.infer<typeof RetrievalReasonSchema>;

export const CAPTURE_STATES = [
	"queued",
	"running",
	"complete",
	"partial",
	"skipped",
	"blocked",
] as const;
export const CaptureStateSchema = z.enum(CAPTURE_STATES);
export type CaptureState = z.infer<typeof CaptureStateSchema>;

export const BLOCKED_REASONS = [
	"no-kubectl",
	"context-missing",
	"identity-mismatch",
	"unauthorised",
	"unreachable",
] as const;
export const BlockedReasonSchema = z.enum(BLOCKED_REASONS);
export type BlockedReason = z.infer<typeof BlockedReasonSchema>;

export const VALID_KINDS = ["instant", "interval", "unknown"] as const;
export const ValidKindSchema = z.enum(VALID_KINDS);
export type ValidKind = z.infer<typeof ValidKindSchema>;

export const BINDING_PROBE_STATES = [
	"unchecked",
	"ok",
	...BLOCKED_REASONS,
] as const;
export const BindingProbeStateSchema = z.enum(BINDING_PROBE_STATES);
export type BindingProbeState = z.infer<typeof BindingProbeStateSchema>;

export const ARTIFACT_PURPOSES = [
	"events",
	"deployments",
	"replicasets",
	"pods",
	"logs-previous",
] as const;
export const ArtifactPurposeSchema = z.enum(ARTIFACT_PURPOSES);
export type ArtifactPurpose = z.infer<typeof ArtifactPurposeSchema>;

export const CLAIM_SOURCE_KINDS = [
	"capture",
	"alert",
	"report",
	"host",
] as const;
export const ClaimSourceKindSchema = z.enum(CLAIM_SOURCE_KINDS);
export type ClaimSourceKind = z.infer<typeof ClaimSourceKindSchema>;

// =============================================================================
// SETTINGS AND BINDINGS
// =============================================================================

export const CaseFileSettingsSchema = z.object({ enabled: z.boolean() });
export type CaseFileSettings = z.infer<typeof CaseFileSettingsSchema>;

/** What kubectl on this machine offered when the binding form opened; never a credential. */
export const BindingDetectionSchema = z.object({
	kubectl: z
		.object({ path: z.string(), version: z.string().nullable() })
		.nullable(),
	contexts: z.array(z.string()),
	currentContext: z.string().nullable().optional(),
	current: z
		.object({
			cluster: z.string().nullable(),
			user: z.string().nullable(),
			namespace: z.string().nullable(),
		})
		.nullable()
		.optional(),
	suggested: z
		.object({ kubeContext: z.string(), namespace: z.string() })
		.nullable()
		.optional(),
});
export type BindingDetection = z.infer<typeof BindingDetectionSchema>;

export const ServiceBindingSchema = z.object({
	id: z.string(),
	serviceId: z.string(),
	kind: z.literal("kubernetes"),
	kubeContext: z.string(),
	cluster: z.string(),
	namespace: z.string(),
	kubeUser: z.string().nullable(),
	detected: BindingDetectionSchema,
	confirmedAt: DateStringSchema,
	probeState: BindingProbeStateSchema,
	probeDetail: z.string().nullable(),
	probedAt: DateStringSchema.nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});
export type ServiceBinding = z.infer<typeof ServiceBindingSchema>;

export const ServiceIdParamSchema = z.object({ serviceId: z.string().uuid() });

export const ConfirmBindingInputSchema = z.object({
	serviceId: z.string().uuid(),
	kubeContext: z.string().min(1).max(253),
	namespace: z.string().min(1).max(63),
});
export type ConfirmBindingInput = z.infer<typeof ConfirmBindingInputSchema>;

// =============================================================================
// CAPTURES AND ARTIFACTS
// =============================================================================

export const CaptureIdentitySchema = z.object({
	kubeContext: z.string(),
	cluster: z.string(),
	kubeUser: z.string().nullable(),
	/** `kubectl auth whoami`; null where client or server predates it. */
	whoami: z
		.object({
			username: z.string(),
			uid: z.string().optional(),
			groups: z.array(z.string()).optional(),
		})
		.nullable(),
	matchesBinding: z.boolean(),
});
export type CaptureIdentity = z.infer<typeof CaptureIdentitySchema>;

/** Per-rule redaction counts, or the error that withheld the redacted copy. */
export const RedactionsSchema = z.union([
	z.record(z.string(), z.number().int().nonnegative()),
	z.object({ error: z.string() }),
]);
export type Redactions = z.infer<typeof RedactionsSchema>;

export const ArtifactSummarySchema = z.object({
	id: z.string(),
	purpose: ArtifactPurposeSchema,
	subject: z.string().nullable(),
	command: z.array(z.string()),
	retrieval: RetrievalSchema,
	retrievalReason: RetrievalReasonSchema.nullable(),
	bytes: z.number().int().nonnegative(),
	redactions: RedactionsSchema,
	withheld: z.boolean(),
	expired: z.boolean(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const CaptureSummarySchema = z.object({
	id: z.string(),
	/** The target this capture ran against; a later rebinding does not rewrite it. */
	kubeContext: z.string(),
	namespace: z.string(),
	state: CaptureStateSchema,
	stateReason: z.string().nullable(),
	missed: z.object({ from: DateStringSchema, to: DateStringSchema }).nullable(),
	shared: z.boolean(),
	latencyMs: z.number().int().nullable(),
	identity: CaptureIdentitySchema.nullable(),
	identityMatches: z.boolean().nullable(),
	startedAt: DateStringSchema.nullable(),
	finishedAt: DateStringSchema.nullable(),
	artifacts: z.array(ArtifactSummarySchema),
});
export type CaptureSummary = z.infer<typeof CaptureSummarySchema>;

export const ArtifactTextSchema = z.object({
	artifact: ArtifactSummarySchema,
	text: z.string(),
	truncated: z.boolean(),
});
export type ArtifactText = z.infer<typeof ArtifactTextSchema>;

export const ManifestVerifySchema = z.object({
	ok: z.boolean(),
	entries: z.number().int().nonnegative(),
	expired: z.number().int().nonnegative(),
	brokenAt: z
		.object({
			seq: z.number().int(),
			check: z.enum(["chain", "columns", "metadata", "file"]),
			detail: z.string(),
		})
		.optional(),
});
export type ManifestVerify = z.infer<typeof ManifestVerifySchema>;

// =============================================================================
// THE CASE VIEW
// =============================================================================

export const ClaimCoverageSchema = z.object({
	retrieval: RetrievalSchema,
	reason: RetrievalReasonSchema.optional(),
	missedFrom: DateStringSchema.optional(),
	missedTo: DateStringSchema.optional(),
	note: z.string().optional(),
});
export type ClaimCoverage = z.infer<typeof ClaimCoverageSchema>;

export const ClaimViewSchema = z.object({
	id: z.string(),
	subject: z.object({
		kind: z.enum(["node", "edge"]),
		label: z.string(),
		relation: z.string().optional(),
		from: z.string().optional(),
		to: z.string().optional(),
	}),
	status: ClaimStatusSchema,
	statusReason: z.string().nullable(),
	statement: z.string(),
	hint: z.string().nullable(),
	attributes: z.record(z.string(), z.unknown()).nullable(),
	revision: z.number().int().positive(),
	revisions: z.number().int().positive(),
	source: z.object({
		kind: ClaimSourceKindSchema,
		provenance: CommandProvenanceSchema,
		artifactId: z.string().nullable(),
		investigationId: z.string().nullable(),
	}),
	population: z.record(z.string(), z.string()).nullable(),
	coverage: ClaimCoverageSchema.nullable(),
	sourceTime: DateStringSchema.nullable(),
	valid: z.object({
		kind: ValidKindSchema,
		from: DateStringSchema.nullable(),
		to: DateStringSchema.nullable(),
	}),
	collectedAt: DateStringSchema.nullable(),
	recordedAt: DateStringSchema,
	/** Built at read time from the agent's run or a missing binding, not stored. */
	projected: z.boolean(),
});
export type ClaimView = z.infer<typeof ClaimViewSchema>;

/** A tool call the agent's harness reported; PrismaLens never saw it run. */
export const AgentToolCallSchema = z.object({
	investigationId: z.string(),
	toolCallId: z.string(),
	name: z.string(),
	source: z.string(),
	at: DateStringSchema,
	provenance: z.literal("harness-reported"),
});
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const CaseViewSchema = z.object({
	enabled: z.boolean(),
	asOf: DateStringSchema,
	binding: z
		.object({
			kubeContext: z.string(),
			namespace: z.string(),
			cluster: z.string(),
			probeState: BindingProbeStateSchema,
		})
		.nullable(),
	captures: z.array(CaptureSummarySchema),
	claims: z.array(ClaimViewSchema),
	/** Ids of claims whose status is candidate, unknown, inconclusive or hint. */
	openQuestions: z.array(z.string()),
	agentToolCalls: z.array(AgentToolCallSchema),
	manifest: z.object({
		entries: z.number().int().nonnegative(),
		lastVerified: z.null(),
	}),
});
export type CaseView = z.infer<typeof CaseViewSchema>;

export const CaseViewQuerySchema = z.object({
	incidentId: z.string().uuid(),
	asOf: DateStringSchema.optional(),
});

export const IncidentIdParamSchema = z.object({
	incidentId: z.string().uuid(),
});

export const ArtifactIdParamSchema = z.object({
	artifactId: z.string().uuid(),
});
