// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The catch-up view (spec §5, s09): stored claim revisions as they stood at
 * `asOf`, plus read-time projections of the agent's report and tool calls,
 * which are `harness-reported` and never stored (R7, §4).
 */
import { Injectable } from "@nestjs/common";
import {
	type AgentToolCall,
	type ArtifactSummary,
	ArtifactSummarySchema,
	type ArtifactText,
	CaptureIdentitySchema,
	type CaptureState,
	type CaptureSummary,
	type CaseView,
	ClaimCoverageSchema,
	ClaimStatusSchema,
	type ClaimView,
	ClaimViewSchema,
	CommandProvenanceSchema,
	InvestigationReportSchema,
	type ManifestVerify,
	type Redactions,
	RedactionsSchema,
	StreamToolResultSchema,
	ValidKindSchema,
} from "@prismalens/contracts";
import type {
	Capture,
	CaptureArtifact,
	CaseCapture,
	CaseEdge,
	CaseNode,
	ClaimRevision,
} from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CaptureService } from "./capture.service.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { ArtifactStore } from "./storage/artifact-store.js";
import { ManifestService } from "./storage/manifest.js";

export const ARTIFACT_TEXT_CAP = 1024 * 1024;
export const MAX_AGENT_TOOL_CALLS = 200;

const OPEN_STATUSES = new Set(["candidate", "unknown", "inconclusive", "hint"]);
const CASE_SOURCE = /^case:([0-9a-f-]{36})\b/i;

export class CaseNotFoundError extends Error {
	constructor(what: string, id: string) {
		super(`${what} ${id} not found`);
	}
}

/** The artifact exists but has no redacted copy to serve (409). */
export class ArtifactUnavailableError extends Error {
	constructor(readonly reason: "withheld" | "expired") {
		super(`artifact is ${reason}`);
	}
}

/** The manual capture could not be queued (412). */
export class CaptureRefusedError extends Error {
	constructor(readonly reason: "disabled" | "unbound") {
		super(
			reason === "disabled"
				? "Case File is off"
				: "the incident's service has no Kubernetes binding",
		);
	}
}

const ReportHypothesesSchema = InvestigationReportSchema.pick({
	hypotheses: true,
});
const ToolCallFieldsSchema = StreamToolResultSchema.pick({
	toolCallId: true,
	name: true,
	source: true,
});
const CommandSchema = ArtifactSummarySchema.shape.command;
const PopulationSchema = ClaimViewSchema.shape.population;
const AttributesSchema = ClaimViewSchema.shape.attributes;

interface Parser<T> {
	safeParse(value: unknown): { success: boolean; data?: T };
}

const iso = (d: Date | null | undefined): string | null =>
	d ? d.toISOString() : null;

function parseJson(text: string | null): unknown {
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function parseWith<T>(schema: Parser<T>, text: string | null): T | null {
	const parsed = schema.safeParse(parseJson(text));
	return parsed.success ? (parsed.data ?? null) : null;
}

function redactionsOf(row: CaptureArtifact): Redactions {
	return (
		parseWith(RedactionsSchema, row.redactions) ?? {
			error: "redaction counts unreadable",
		}
	);
}

export function artifactSummary(row: CaptureArtifact): ArtifactSummary {
	const redactions = redactionsOf(row);
	return {
		id: row.id,
		purpose: row.purpose as ArtifactSummary["purpose"],
		subject: row.subject,
		command: parseWith(CommandSchema, row.command) ?? [],
		retrieval: row.retrieval as ArtifactSummary["retrieval"],
		retrievalReason: row.retrievalReason as ArtifactSummary["retrievalReason"],
		bytes: row.redactedBytes,
		redactions,
		withheld: "error" in redactions,
		expired: row.expiredAt !== null,
	};
}

/** One capture as one case saw it: latency runs from that case's own trigger. */
export function captureSummary(
	capture: Capture,
	link: Pick<CaseCapture, "shared" | "triggeredAt">,
	artifacts: CaptureArtifact[],
): CaptureSummary {
	return {
		id: capture.id,
		state: capture.state as CaptureState,
		stateReason: capture.stateReason,
		missed:
			capture.missedFrom && capture.missedTo
				? {
						from: capture.missedFrom.toISOString(),
						to: capture.missedTo.toISOString(),
					}
				: null,
		shared: link.shared,
		latencyMs: capture.startedAt
			? capture.startedAt.getTime() - link.triggeredAt.getTime()
			: null,
		identity: parseWith(CaptureIdentitySchema, capture.identity),
		identityMatches: capture.identityMatches,
		startedAt: iso(capture.startedAt),
		finishedAt: iso(capture.finishedAt),
		artifacts: [...artifacts]
			.sort((a, b) => a.seq - b.seq)
			.map(artifactSummary),
	};
}

type RevisionRow = ClaimRevision & {
	node: CaseNode | null;
	edge: (CaseEdge & { from: CaseNode; to: CaseNode }) | null;
};

function subjectOf(rev: RevisionRow): ClaimView["subject"] {
	if (rev.edge) {
		const { from, to, relation } = rev.edge;
		return {
			kind: "edge",
			label: `${from.label} ${relation} ${to.label}`,
			relation,
			from: from.label,
			to: to.label,
		};
	}
	return { kind: "node", label: rev.node?.label ?? "unknown subject" };
}

/** A stored revision as the view shows it; a gap's hint lives in `attributes.hint`. */
export function storedClaim(rev: RevisionRow, revisions: number): ClaimView {
	const attributes = parseWith(AttributesSchema, rev.attributes);
	const hint = attributes?.hint;
	return {
		id: rev.id,
		subject: subjectOf(rev),
		status: ClaimStatusSchema.parse(rev.status),
		statusReason: rev.statusReason,
		statement: rev.statement,
		hint: typeof hint === "string" ? hint : null,
		attributes,
		revision: rev.revision,
		revisions,
		source: {
			kind: rev.sourceKind === "alert" ? "alert" : "capture",
			provenance: CommandProvenanceSchema.parse(rev.provenance),
			artifactId: rev.artifactId,
			investigationId: null,
		},
		population: parseWith(PopulationSchema, rev.population),
		coverage: parseWith(ClaimCoverageSchema, rev.coverage),
		sourceTime: iso(rev.sourceTime),
		valid: {
			kind: ValidKindSchema.parse(rev.validKind),
			from: iso(rev.validFrom),
			to: iso(rev.validTo),
		},
		collectedAt: iso(rev.collectedAt),
		recordedAt: rev.recordedAt.toISOString(),
		projected: false,
	};
}

/** Latest revision per subject recorded by `asOf`, with how many it had by then. */
export function latestPerSubject(
	rows: RevisionRow[],
): { rev: RevisionRow; revisions: number }[] {
	const bySubject = new Map<string, { rev: RevisionRow; revisions: number }>();
	for (const rev of rows) {
		const key = rev.nodeId ? `n:${rev.nodeId}` : `e:${rev.edgeId ?? rev.id}`;
		const seen = bySubject.get(key);
		if (!seen) bySubject.set(key, { rev, revisions: 1 });
		else
			bySubject.set(key, {
				rev: rev.revision > seen.rev.revision ? rev : seen.rev,
				revisions: seen.revisions + 1,
			});
	}
	return [...bySubject.values()];
}

function projectedClaim(
	fields: Pick<
		ClaimView,
		"id" | "subject" | "status" | "statusReason" | "statement" | "hint"
	> &
		Partial<Pick<ClaimView, "attributes">> & {
			source: ClaimView["source"];
			recordedAt: string;
		},
): ClaimView {
	return {
		attributes: null,
		...fields,
		revision: 1,
		revisions: 1,
		population: null,
		coverage: null,
		sourceTime: null,
		valid: { kind: "unknown", from: null, to: null },
		collectedAt: null,
		projected: true,
	};
}

/** The gap a case shows when no capture can run for it: nothing is stored for it. */
export function unboundGap(
	incidentId: string,
	hasService: boolean,
	asOf: string,
): ClaimView {
	return projectedClaim({
		id: `gap:${incidentId}:unbound`,
		subject: { kind: "node", label: "unbound" },
		status: "unknown",
		statusReason: "unbound",
		statement: hasService
			? "No pod state captured: this incident's service isn't bound to a Kubernetes target."
			: "No pod state captured: this incident has no service.",
		hint: hasService
			? "Bind the service in Services."
			: "Link the incident to a service, then bind it in Services.",
		source: {
			kind: "host",
			provenance: "host-executed",
			artifactId: null,
			investigationId: null,
		},
		recordedAt: asOf,
	});
}

/** A completed run's hypotheses, always `inferred`: the agent's own label is kept as `agentStatus` (R8). */
export function reportClaims(
	investigation: { id: string; report: string | null; completedAt: Date },
	artifactIds: ReadonlySet<string>,
): ClaimView[] {
	const report = parseWith(ReportHypothesesSchema, investigation.report);
	if (!report) return [];
	return report.hypotheses.map((h, i) => {
		const cited = h.evidence
			.map((e) => CASE_SOURCE.exec(e.source)?.[1])
			.find((id): id is string => !!id && artifactIds.has(id));
		return projectedClaim({
			id: `report:${investigation.id}:${i + 1}`,
			subject: { kind: "node", label: `Hypothesis ${i + 1}` },
			status: "inferred",
			statusReason: null,
			statement: h.statement,
			hint: null,
			attributes: {
				agentStatus: h.status,
				rank: i + 1,
				evidence: h.evidence.map((e) => ({
					observation: e.observation,
					source: e.source,
					direction: e.direction,
					status: e.status,
				})),
			},
			source: {
				kind: "report",
				provenance: "harness-reported",
				artifactId: cited ?? null,
				investigationId: investigation.id,
			},
			recordedAt: investigation.completedAt.toISOString(),
		});
	});
}

export function toolCallOf(
	investigationId: string,
	event: string,
): AgentToolCall | null {
	const row = parseJson(event);
	if (typeof row !== "object" || row === null) return null;
	const { kind, ts, result: raw } = row as Record<string, unknown>;
	const result = ToolCallFieldsSchema.safeParse(raw);
	if (kind !== "tool_result" || typeof ts !== "string" || !result.success)
		return null;
	const { toolCallId, name, source } = result.data;
	return {
		investigationId,
		toolCallId,
		name,
		source,
		at: ts,
		provenance: "harness-reported",
	};
}

@Injectable()
export class CaseViewService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly settings: CaseFileSettingsService,
		private readonly store: ArtifactStore,
		private readonly manifest: ManifestService,
		private readonly captures: CaptureService,
	) {}

	async get(incidentId: string, asOfText?: string): Promise<CaseView> {
		const asOfDate = asOfText ? new Date(asOfText) : new Date();
		const asOf = asOfDate.toISOString();
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			include: { service: { include: { binding: true } } },
		});
		if (!incident) throw new CaseNotFoundError("incident", incidentId);
		const empty: CaseView = {
			enabled: false,
			asOf,
			binding: null,
			captures: [],
			claims: [],
			openQuestions: [],
			agentToolCalls: [],
			manifest: { entries: 0, lastVerified: null },
		};
		if (!(await this.settings.isEnabled())) return empty;

		const binding = incident.service?.binding ?? null;
		const links = await this.prisma.caseCapture.findMany({
			where: { incidentId },
			include: { capture: { include: { artifacts: true } } },
			orderBy: { createdAt: "asc" },
		});
		const captureIds = links.map((l) => l.captureId);
		const artifactIds = new Set(
			links.flatMap((l) => l.capture.artifacts.map((a) => a.id)),
		);

		const [revisions, investigations, entries] = await Promise.all([
			this.prisma.claimRevision.findMany({
				where: { incidentId, recordedAt: { lte: asOfDate } },
				include: {
					node: true,
					edge: { include: { from: true, to: true } },
				},
				orderBy: [{ recordedAt: "asc" }, { revision: "asc" }],
			}),
			this.prisma.investigation.findMany({
				where: { incidentId },
				select: { id: true, report: true, completedAt: true },
				orderBy: { createdAt: "asc" },
			}),
			this.prisma.manifestEntry.count({
				where: { captureId: { in: captureIds } },
			}),
		]);

		const claims: ClaimView[] = latestPerSubject(revisions).map((s) =>
			storedClaim(s.rev, s.revisions),
		);
		if (!binding)
			claims.push(unboundGap(incidentId, incident.serviceId !== null, asOf));
		for (const inv of investigations) {
			if (inv.completedAt && inv.completedAt <= asOfDate)
				claims.push(
					...reportClaims(
						{ id: inv.id, report: inv.report, completedAt: inv.completedAt },
						artifactIds,
					),
				);
		}

		return {
			enabled: true,
			asOf,
			binding: binding && {
				kubeContext: binding.kubeContext,
				namespace: binding.namespace,
				cluster: binding.cluster,
				probeState: binding.probeState as NonNullable<
					CaseView["binding"]
				>["probeState"],
			},
			captures: links.map((l) =>
				captureSummary(l.capture, l, l.capture.artifacts),
			),
			claims,
			openQuestions: claims
				.filter((c) => OPEN_STATUSES.has(c.status))
				.map((c) => c.id),
			agentToolCalls: await this.toolCalls(
				investigations.map((i) => i.id),
				asOfDate,
			),
			manifest: { entries, lastVerified: null },
		};
	}

	/** The redacted copy only, capped at {@link ARTIFACT_TEXT_CAP}; the raw copy is never served (R3). */
	async artifact(artifactId: string): Promise<ArtifactText> {
		const row = await this.prisma.captureArtifact.findUnique({
			where: { id: artifactId },
		});
		if (!row) throw new CaseNotFoundError("artifact", artifactId);
		const summary = artifactSummary(row);
		if (summary.withheld) throw new ArtifactUnavailableError("withheld");
		const read = await this.store.readRedacted(row, ARTIFACT_TEXT_CAP);
		if (!read) throw new ArtifactUnavailableError("expired");
		return { artifact: summary, ...read };
	}

	async verify(incidentId: string): Promise<ManifestVerify> {
		await this.requireIncident(incidentId);
		const links = await this.prisma.caseCapture.findMany({
			where: { incidentId },
			select: { captureId: true },
		});
		return this.manifest.verify(links.map((l) => l.captureId));
	}

	async capture(incidentId: string): Promise<CaptureSummary> {
		await this.requireIncident(incidentId);
		if (!(await this.settings.isEnabled()))
			throw new CaptureRefusedError("disabled");
		const queued = await this.captures.captureNow(incidentId);
		if (!queued) throw new CaptureRefusedError("unbound");
		const link = await this.prisma.caseCapture.findUniqueOrThrow({
			where: {
				incidentId_captureId: { incidentId, captureId: queued.captureId },
			},
			include: { capture: { include: { artifacts: true } } },
		});
		return captureSummary(link.capture, link, link.capture.artifacts);
	}

	private async requireIncident(incidentId: string): Promise<void> {
		const found = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: { id: true },
		});
		if (!found) throw new CaseNotFoundError("incident", incidentId);
	}

	/** Tool results the agent's harness reported, newest {@link MAX_AGENT_TOOL_CALLS}. */
	private async toolCalls(
		investigationIds: string[],
		asOf: Date,
	): Promise<AgentToolCall[]> {
		if (investigationIds.length === 0) return [];
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: { in: investigationIds },
				createdAt: { lte: asOf },
				event: { contains: '"kind":"tool_result"' },
			},
			orderBy: { createdAt: "desc" },
			take: MAX_AGENT_TOOL_CALLS,
		});
		return rows.flatMap((r) => toolCallOf(r.investigationId, r.event) ?? []);
	}
}
