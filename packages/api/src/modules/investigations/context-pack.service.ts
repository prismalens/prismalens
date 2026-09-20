// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type {
	ChangeFact,
	ContextPack,
	NeighborService,
	PriorIncidentFact,
	UnavailableFamily,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { computeWindow } from "../overlay/overlay.logic.js";

/** Coerce a metadata value to a trimmed identifier string, or null (mirrors overlay.service.ts). */
function asIdentifier(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number") return String(value);
	return null;
}

/** Parse a DB JSON labels field into a flat string map (mirrors overlay.service.ts). */
function parseLabels(raw: string | null): Record<string, string> | null {
	const obj = safeParseJsonObject(raw);
	if (!obj) return null;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[k] = typeof v === "string" ? v : JSON.stringify(v);
	}
	return out;
}

const KNOWN_CHANGE_KINDS = new Set<ChangeFact["kind"]>([
	"deployment",
	"config",
	"migration",
	"rollback",
]);

/** The lowercased `alertname` label value of each alert, when set. */
function alertnameSet(alerts: Array<{ labels: string | null }>): Set<string> {
	const set = new Set<string>();
	for (const a of alerts) {
		const an = parseLabels(a.labels)?.alertname;
		if (an?.trim()) set.add(an.trim().toLowerCase());
	}
	return set;
}

/** Every `key=value` label pair across the given alerts, lowercased. */
function labelPairSet(alerts: Array<{ labels: string | null }>): Set<string> {
	const set = new Set<string>();
	for (const a of alerts) {
		const labels = parseLabels(a.labels);
		if (!labels) continue;
		for (const [k, v] of Object.entries(labels))
			set.add(`${k}=${v}`.toLowerCase());
	}
	return set;
}

function errorMessage(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return msg.slice(0, 200);
}

/** `a ∩ b` — the tsconfig's `lib` (ES2022) predates `Set.prototype.intersection`. */
function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
	const out = new Set<T>();
	for (const x of a) if (b.has(x)) out.add(x);
	return out;
}

/**
 * Assembles the CONTEXT PACK (ADR-0016 §5) for one incident: host-side facts the
 * rented harness cannot reach by iterating over logs, metrics, and the repo in its
 * cwd — deploy/config changes in the alert window, the one-hop service
 * neighbourhood, and prior similar incidents.
 *
 * PRE-dispatch (ADR-0011 amendment 2026-07-09), pulled on demand (ADR-0022).
 * Deliberately does NOT import {@link OverlayService} — that one is POST-report
 * enrichment keyed on report hypotheses, computed after the run. This reuses only
 * the query shapes {@link OverlayService} already proved out (affected-service
 * resolution, {@link computeWindow}), not the service itself.
 *
 * {@link assemble} never throws: a family whose query fails is recorded in
 * `unavailable` with its reason and the other families still fill (ADR-0022,
 * honest degradation). Returns `null` only when the incident does not exist.
 */
@Injectable()
export class ContextPackService {
	private readonly logger = new Logger(ContextPackService.name);

	constructor(private readonly prisma: PrismaService) {}

	async assemble(incidentId: string): Promise<ContextPack | null> {
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: {
				id: true,
				serviceId: true,
				alerts: {
					select: {
						serviceId: true,
						title: true,
						labels: true,
						triggeredAt: true,
					},
				},
			},
		});
		if (!incident) return null;

		const affectedServiceIds = new Set<string>();
		if (incident.serviceId) affectedServiceIds.add(incident.serviceId);
		for (const a of incident.alerts)
			if (a.serviceId) affectedServiceIds.add(a.serviceId);
		const affected = [...affectedServiceIds];

		const window = computeWindow(
			incident.alerts.map((a) => a.triggeredAt),
			new Date(),
		);

		const unavailable: UnavailableFamily[] = [];

		let changes: ChangeFact[] = [];
		try {
			changes = await this.loadChanges(affected, window);
		} catch (e) {
			this.logger.warn(
				`Context pack: changes family failed — ${errorMessage(e)}`,
			);
			unavailable.push({ family: "changes", reason: errorMessage(e) });
		}

		let neighbors: NeighborService[] = [];
		try {
			neighbors = await this.loadNeighbors(affected);
		} catch (e) {
			this.logger.warn(
				`Context pack: neighbors family failed — ${errorMessage(e)}`,
			);
			unavailable.push({ family: "neighbors", reason: errorMessage(e) });
		}

		let priorIncidents: PriorIncidentFact[] = [];
		try {
			priorIncidents = await this.loadPriorIncidents(
				incident.id,
				incident.serviceId,
				incident.alerts,
			);
		} catch (e) {
			this.logger.warn(
				`Context pack: priorIncidents family failed — ${errorMessage(e)}`,
			);
			unavailable.push({ family: "priorIncidents", reason: errorMessage(e) });
		}

		return {
			window: {
				start: window.start.toISOString(),
				end: window.end.toISOString(),
			},
			changes,
			neighbors,
			priorIncidents,
			unavailable,
			assembledAt: new Date().toISOString(),
		};
	}

	private async loadChanges(
		affected: string[],
		window: { start: Date; end: Date },
	): Promise<ChangeFact[]> {
		if (affected.length === 0) return [];
		const rows = await this.prisma.changeEvent.findMany({
			where: {
				serviceId: { in: affected },
				timestamp: { gte: window.start, lte: window.end },
			},
			orderBy: { timestamp: "desc" },
			take: 20,
		});
		if (rows.length === 0) return [];

		const serviceIds = [
			...new Set(
				rows.map((r) => r.serviceId).filter((id): id is string => Boolean(id)),
			),
		];
		const services = serviceIds.length
			? await this.prisma.service.findMany({
					where: { id: { in: serviceIds } },
					select: { id: true, name: true },
				})
			: [];
		const nameById = new Map(services.map((s) => [s.id, s.name]));

		const facts: ChangeFact[] = [];
		for (const r of rows) {
			// Commits are explicitly out of scope for the context pack; anything else
			// unrecognised is dropped too rather than mis-typed onto a wrong kind.
			if (!KNOWN_CHANGE_KINDS.has(r.type as ChangeFact["kind"])) continue;
			const meta = safeParseJsonObject(r.metadata) ?? {};
			const ref =
				asIdentifier(meta.version) ??
				asIdentifier(meta.sha) ??
				asIdentifier(meta.commit);
			facts.push({
				kind: r.type as ChangeFact["kind"],
				service: r.serviceId ? (nameById.get(r.serviceId) ?? null) : null,
				at: r.timestamp.toISOString(),
				source: r.source,
				ref,
				summary: (r.description ?? r.type).slice(0, 300),
			});
		}
		return facts;
	}

	private async loadNeighbors(affected: string[]): Promise<NeighborService[]> {
		if (affected.length === 0) return [];
		const edges = await this.prisma.serviceDependency.findMany({
			where: { dependencyId: { in: affected } },
			include: { dependent: true },
			take: 20,
		});
		return edges.map((e) => ({
			name: e.dependent.name,
			relation: "dependent" as const,
			criticality: (e.criticality as NeighborService["criticality"]) ?? null,
		}));
	}

	private async loadPriorIncidents(
		incidentId: string,
		serviceId: string | null,
		currentAlerts: Array<{ title: string; labels: string | null }>,
	): Promise<PriorIncidentFact[]> {
		const currentAlertnames = alertnameSet(currentAlerts);
		const currentLabelPairs = labelPairSet(currentAlerts);

		const candidates = await this.prisma.incident.findMany({
			where: { id: { not: incidentId } },
			orderBy: { createdAt: "desc" },
			take: 200,
			select: {
				id: true,
				number: true,
				title: true,
				serviceId: true,
				actualCause: true,
				createdAt: true,
				alerts: { select: { title: true, labels: true } },
				investigations: {
					where: { status: "completed" },
					orderBy: { completedAt: "desc" },
					take: 1,
					select: { rootCause: true },
				},
			},
		});

		let serviceName: string | null = null;
		if (serviceId) {
			const svc = await this.prisma.service.findUnique({
				where: { id: serviceId },
				select: { name: true },
			});
			serviceName = svc?.name ?? null;
		}

		const scored = candidates
			.map((c) => {
				const sameService = Boolean(serviceId) && serviceId === c.serviceId;
				const sharedAlertnames = intersect(
					alertnameSet(c.alerts),
					currentAlertnames,
				);
				if (!sameService && sharedAlertnames.size === 0) return null;
				const sharedLabels = intersect(
					labelPairSet(c.alerts),
					currentLabelPairs,
				);
				return { c, sameService, sharedLabels, sharedCount: sharedLabels.size };
			})
			.filter((x): x is NonNullable<typeof x> => x !== null)
			.sort(
				(a, b) =>
					b.sharedCount - a.sharedCount ||
					b.c.createdAt.getTime() - a.c.createdAt.getTime(),
			)
			.slice(0, 5);

		return scored.map(({ c, sameService, sharedLabels }) => {
			const matchedOn: string[] = [];
			if (sameService && serviceName) matchedOn.push(`service: ${serviceName}`);
			for (const pair of sharedLabels) {
				if (matchedOn.length >= 10) break;
				matchedOn.push(pair.slice(0, 80));
			}
			const rootCause = c.actualCause ?? c.investigations[0]?.rootCause ?? null;
			return {
				reference: `INC-${c.number}`,
				title: c.title.slice(0, 200),
				rootCause: rootCause ? rootCause.slice(0, 500) : null,
				matchedOn: matchedOn.slice(0, 10),
			};
		});
	}
}
