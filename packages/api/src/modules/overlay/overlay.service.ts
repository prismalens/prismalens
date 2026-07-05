import { Injectable, Logger } from "@nestjs/common";
import type { InvestigationReport, Overlay } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import {
	buildLabelSet,
	type ChangeCandidateInput,
	computeProximity,
	computeWindow,
	correlateChanges,
	type OverlayHypothesisInput,
	type PastIncidentInput,
	type SimilarIncidentResult,
	type SimilarityInput,
	selectSimilarIncidents,
	toStoredScore,
} from "./overlay.logic.js";

/** Coerce a metadata value to a trimmed identifier string, or null. */
function asIdentifier(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number") return String(value);
	return null;
}

/** Parse a DB JSON labels field into a flat string map (values coerced to string). */
function parseLabels(raw: string | null): Record<string, string> | null {
	const obj = safeParseJsonObject(raw);
	if (!obj) return null;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[k] = typeof v === "string" ? v : JSON.stringify(v);
	}
	return out;
}

/**
 * OverlayService — the app-side reduce overlay (ADR-0016 §5c, "the moat").
 *
 * After the engine's canonical report lands, this computes enrichment BESIDE it
 * (never mutating the report; ADR-0011 keeps the engine db-clean, so all of this
 * lives here in the api, not in @prismalens/engine):
 *   (a) CORRELATE report hypotheses against the Deployment/ChangeEvent timeline;
 *   (b) RANK named services by service-graph proximity to the affected service;
 *   (c) SIMILARITY vs past incidents (Jaccard on alert labels + bonuses), writing
 *       the top-K back to IncidentSimilarity so memory grows each run.
 *
 * The result is persisted as JSON on `Investigation.overlay`. Everything here is
 * deterministic — NO LLM. Callers invoke {@link computeOverlay} fire-and-forget:
 * overlay failure must never fail the investigation.
 */
@Injectable()
export class OverlayService {
	private readonly logger = new Logger(OverlayService.name);

	constructor(private readonly prisma: PrismaService) {}

	async computeOverlay(investigationId: string): Promise<Overlay | null> {
		const investigation = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			include: { incident: true },
		});
		if (!investigation) {
			this.logger.warn(
				`Overlay skipped — investigation ${investigationId} not found`,
			);
			return null;
		}

		const report = safeParseJsonObject(investigation.report) as
			| InvestigationReport
			| undefined;
		if (!report || !Array.isArray(report.hypotheses)) {
			// No canonical report to enrich — nothing to correlate against.
			return null;
		}

		const incident = investigation.incident;
		const hypotheses: OverlayHypothesisInput[] = report.hypotheses.map((h) => ({
			statement: h.statement,
			evidence: (h.evidence ?? []).map((e) => ({
				observation: e.observation,
				source: e.source,
			})),
		}));

		// --- affected services + service-name universe --------------------------
		const alerts = await this.prisma.alert.findMany({
			where: { incidentId: incident.id },
			select: { serviceId: true, title: true, labels: true, triggeredAt: true },
		});
		const affectedServiceIds = new Set<string>();
		if (incident.serviceId) affectedServiceIds.add(incident.serviceId);
		for (const a of alerts)
			if (a.serviceId) affectedServiceIds.add(a.serviceId);
		const affectedIdArr = [...affectedServiceIds];

		const services = await this.prisma.service.findMany({
			select: { id: true, name: true },
		});
		const nameById = new Map(services.map((s) => [s.id, s.name]));
		const affectedNames = affectedIdArr
			.map((id) => nameById.get(id))
			.filter((n): n is string => Boolean(n));

		// --- service-graph neighbourhood (proximity 1) --------------------------
		const depEdges = affectedIdArr.length
			? await this.prisma.serviceDependency.findMany({
					where: {
						OR: [
							{ dependentId: { in: affectedIdArr } },
							{ dependencyId: { in: affectedIdArr } },
						],
					},
					select: { dependentId: true, dependencyId: true },
				})
			: [];
		const dependencyNames: string[] = [];
		const dependentNames: string[] = [];
		for (const e of depEdges) {
			if (affectedServiceIds.has(e.dependentId)) {
				const n = nameById.get(e.dependencyId);
				if (n) dependencyNames.push(n);
			}
			if (affectedServiceIds.has(e.dependencyId)) {
				const n = nameById.get(e.dependentId);
				if (n) dependentNames.push(n);
			}
		}

		// --- (a) CORRELATE against the deploy/change timeline -------------------
		const reportTime = investigation.completedAt ?? new Date();
		const window = computeWindow(
			alerts.map((a) => a.triggeredAt),
			reportTime,
		);

		const [deployments, changeEvents] = affectedIdArr.length
			? await Promise.all([
					this.prisma.deployment.findMany({
						where: { serviceId: { in: affectedIdArr } },
					}),
					this.prisma.changeEvent.findMany({
						where: { serviceId: { in: affectedIdArr } },
					}),
				])
			: [[], []];

		const candidates: ChangeCandidateInput[] = [];
		for (const d of deployments) {
			const meta = safeParseJsonObject(d.metadata) ?? {};
			const identifiers = [
				d.externalId,
				d.name,
				d.branch,
				asIdentifier(meta.version),
				asIdentifier(meta.commit),
				asIdentifier(meta.sha),
			].filter((x): x is string => Boolean(x));
			candidates.push({
				kind: "deployment",
				id: d.id,
				title: d.name,
				source: "deployment",
				serviceName: d.serviceId ? (nameById.get(d.serviceId) ?? null) : null,
				timestamp: d.lastDeployedAt ?? d.createdAt,
				identifiers,
			});
		}
		for (const c of changeEvents) {
			const meta = safeParseJsonObject(c.metadata) ?? {};
			const identifiers = [
				asIdentifier(meta.version),
				asIdentifier(meta.commit),
				asIdentifier(meta.sha),
			].filter((x): x is string => Boolean(x));
			candidates.push({
				kind: "change_event",
				id: c.id,
				title: c.description ?? c.type,
				source: c.source,
				serviceName: c.serviceId ? (nameById.get(c.serviceId) ?? null) : null,
				timestamp: c.timestamp,
				identifiers,
			});
		}
		const matchedChanges = correlateChanges(hypotheses, candidates, window);

		// --- (b) RANK named services by graph proximity -------------------------
		const serviceProximity = computeProximity(
			hypotheses,
			services.map((s) => s.name),
			{
				affected: affectedNames,
				dependencies: dependencyNames,
				dependents: dependentNames,
			},
		);

		// --- (c) SIMILARITY vs past incidents -----------------------------------
		const current: SimilarityInput = {
			labels: buildLabelSet(
				alerts.map((a) => ({ title: a.title, labels: parseLabels(a.labels) })),
			),
			serviceId: incident.serviceId ?? null,
			rootCauseCategory: investigation.rootCauseCategory ?? null,
		};

		// Candidate pool is the 200 most-recent incidents, not the whole table — this
		// scan runs on every completed investigation, so it must stay bounded. A
		// service/label pre-filter is a later design call (review note 2026-07-05);
		// recency is the safe cap since similar incidents age out of relevance.
		const pastIncidents = await this.prisma.incident.findMany({
			where: { id: { not: incident.id } },
			orderBy: { createdAt: "desc" },
			take: 200,
			include: {
				alerts: { select: { title: true, labels: true } },
				investigations: {
					where: { rootCauseCategory: { not: null } },
					orderBy: { completedAt: "desc" },
					take: 1,
					select: { rootCauseCategory: true },
				},
			},
		});
		const past: PastIncidentInput[] = pastIncidents.map((pi) => ({
			incidentId: pi.id,
			incidentNumber: pi.number,
			title: pi.title,
			similarity: {
				labels: buildLabelSet(
					pi.alerts.map((a) => ({
						title: a.title,
						labels: parseLabels(a.labels),
					})),
				),
				serviceId: pi.serviceId ?? null,
				rootCauseCategory: pi.investigations[0]?.rootCauseCategory ?? null,
			},
		}));
		const similarIncidents = selectSimilarIncidents(current, past);

		// Write memory back — top-K IncidentSimilarity rows (upsert, idempotent).
		await this.writeSimilarities(incident.id, similarIncidents);

		// --- persist the overlay BESIDE the canonical report --------------------
		const overlay: Overlay = {
			matchedChanges,
			serviceProximity,
			similarIncidents,
			computedAt: new Date().toISOString(),
		};
		await this.prisma.investigation.update({
			where: { id: investigationId },
			data: { overlay: JSON.stringify(overlay) },
		});

		this.logger.log(
			`Computed overlay for investigation ${investigationId}: ${matchedChanges.length} matched change(s), ${serviceProximity.length} ranked service(s), ${similarIncidents.length} similar incident(s)`,
		);
		return overlay;
	}

	/**
	 * Write the top-K IncidentSimilarity rows for an incident: upsert the current
	 * set on the unique (incidentId, similarIncidentId) key, then PRUNE rows that
	 * fell below the threshold / out of the top-K since the last run — otherwise a
	 * re-run leaves stale scores behind as durable "memory" that would mislead the
	 * first future reader of the table (review note 2026-07-05).
	 */
	async writeSimilarities(
		incidentId: string,
		similar: SimilarIncidentResult[],
	): Promise<void> {
		for (const s of similar) {
			const matchFactors = JSON.stringify(s.factors);
			const similarityScore = toStoredScore(s.score);
			await this.prisma.incidentSimilarity.upsert({
				where: {
					incidentId_similarIncidentId: {
						incidentId,
						similarIncidentId: s.incidentId,
					},
				},
				create: {
					incidentId,
					similarIncidentId: s.incidentId,
					similarityScore,
					matchFactors,
				},
				update: {
					similarityScore,
					matchFactors,
					calculatedAt: new Date(),
				},
			});
		}
		await this.prisma.incidentSimilarity.deleteMany({
			where: {
				incidentId,
				similarIncidentId: { notIn: similar.map((s) => s.incidentId) },
			},
		});
	}
}
