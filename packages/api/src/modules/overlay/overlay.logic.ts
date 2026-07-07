// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Reduce-overlay pure logic (ADR-0016 §5c — "the moat").
 *
 * Deterministic, dependency-free functions — NO LLM, NO prisma. The
 * {@link OverlayService} fetches rows and feeds plain inputs here; these are the
 * unit-tested core (windowing, keyword correlation, service-graph proximity,
 * Jaccard similarity). Keeping them pure is what makes the overlay reproducible
 * and hermetically testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// (a) CORRELATE — hypotheses vs the deploy/change timeline
// =============================================================================

export interface OverlayHypothesisInput {
	statement: string;
	evidence: Array<{ observation: string; source: string }>;
}

export interface CorrelationWindow {
	start: Date;
	end: Date;
}

/**
 * The correlation window: [earliest alert start - 24h, report time]. With no
 * alert times, anchors the 24h look-back on the report time itself.
 */
export function computeWindow(
	alertStartTimes: Date[],
	reportTime: Date,
): CorrelationWindow {
	const times = alertStartTimes
		.map((d) => d.getTime())
		.filter((t) => Number.isFinite(t));
	const earliest = times.length > 0 ? Math.min(...times) : reportTime.getTime();
	return { start: new Date(earliest - DAY_MS), end: reportTime };
}

/** Lowercased search text for a hypothesis: statement + every evidence obs/source. */
export function hypothesisHaystack(h: OverlayHypothesisInput): string {
	const parts = [h.statement];
	for (const e of h.evidence) {
		parts.push(e.observation, e.source);
	}
	// NUL-join so tokens never bleed across fields into a false boundary match.
	return parts.join("\u0000").toLowerCase();
}

const isWordChar = (c: string): boolean => /[a-z0-9]/.test(c);

/**
 * Whole-token containment: `needle` (case-insensitive, >= 3 chars) appears in
 * `haystack` bounded by non-alphanumerics — so "api" does not match inside
 * "apihandler", while a full identifier like "payments-api" or a deploy id matches.
 */
export function containsToken(haystack: string, needle: string): boolean {
	const n = needle.trim().toLowerCase();
	if (n.length < 3) return false;
	let from = 0;
	while (from <= haystack.length - n.length) {
		const idx = haystack.indexOf(n, from);
		if (idx < 0) return false;
		const before = idx === 0 ? "" : haystack[idx - 1];
		const after =
			idx + n.length >= haystack.length ? "" : haystack[idx + n.length];
		if (
			(before === "" || !isWordChar(before)) &&
			(after === "" || !isWordChar(after))
		) {
			return true;
		}
		from = idx + 1;
	}
	return false;
}

export interface ChangeCandidateInput {
	kind: "deployment" | "change_event";
	id: string;
	title: string;
	source: string;
	serviceName: string | null;
	timestamp: Date;
	/** Deploy/change identifiers to keyword-match (externalId, version, sha, …). */
	identifiers: string[];
}

export interface MatchedChangeResult {
	kind: "deployment" | "change_event";
	id: string;
	title: string;
	source: string;
	serviceName: string | null;
	timestamp: string;
	hypothesisIndex: number;
	matchedOn: string;
}

/**
 * Match each timeline row (already scoped to the affected service) against the
 * report's ordered hypotheses. A row is kept when its service name OR one of its
 * identifiers appears as a whole token in a hypothesis; it is attributed to the
 * lowest-index (most-plausible) matching hypothesis. Rows outside the window are
 * dropped.
 */
export function correlateChanges(
	hypotheses: OverlayHypothesisInput[],
	changes: ChangeCandidateInput[],
	window: CorrelationWindow,
): MatchedChangeResult[] {
	const haystacks = hypotheses.map(hypothesisHaystack);
	const results: MatchedChangeResult[] = [];
	const startMs = window.start.getTime();
	const endMs = window.end.getTime();

	for (const change of changes) {
		const t = change.timestamp.getTime();
		if (!Number.isFinite(t) || t < startMs || t > endMs) continue;

		const needles = [change.serviceName, ...change.identifiers].filter(
			(x): x is string => typeof x === "string" && x.trim().length >= 3,
		);

		for (let i = 0; i < haystacks.length; i++) {
			const matched = needles.find((n) => containsToken(haystacks[i], n));
			if (matched) {
				results.push({
					kind: change.kind,
					id: change.id,
					title: change.title,
					source: change.source,
					serviceName: change.serviceName,
					timestamp: change.timestamp.toISOString(),
					hypothesisIndex: i,
					matchedOn: matched,
				});
				break; // one entry per change, attributed to the top matching hypothesis
			}
		}
	}
	return results;
}

// =============================================================================
// (b) RANK CONTEXT — service-graph proximity
// =============================================================================

export interface ProximityGraphInput {
	/** Affected service names (proximity 0 — self). */
	affected: string[];
	/** Services the affected service depends ON (proximity 1). */
	dependencies: string[];
	/** Services depending ON the affected service (proximity 1). */
	dependents: string[];
}

export interface ServiceProximityResult {
	serviceName: string;
	proximity: 0 | 1 | 2;
	relation: "self" | "dependency" | "dependent" | "beyond";
	hypothesisIndexes: number[];
}

/**
 * For every known service name that a hypothesis references, rank it by distance
 * from the incident's affected service: 0=self, 1=direct dependency/dependent,
 * 2=beyond. Services no hypothesis names are omitted. Sorted nearest-first, then
 * by name for determinism.
 */
export function computeProximity(
	hypotheses: OverlayHypothesisInput[],
	candidateServiceNames: string[],
	graph: ProximityGraphInput,
): ServiceProximityResult[] {
	const haystacks = hypotheses.map(hypothesisHaystack);
	const affected = new Set(graph.affected.map((s) => s.toLowerCase()));
	const deps = new Set(graph.dependencies.map((s) => s.toLowerCase()));
	const dependents = new Set(graph.dependents.map((s) => s.toLowerCase()));

	const seen = new Set<string>();
	const results: ServiceProximityResult[] = [];

	for (const name of candidateServiceNames) {
		const key = name.toLowerCase();
		if (!name.trim() || seen.has(key)) continue;
		seen.add(key);

		const hypothesisIndexes: number[] = [];
		for (let i = 0; i < haystacks.length; i++) {
			if (containsToken(haystacks[i], name)) hypothesisIndexes.push(i);
		}
		if (hypothesisIndexes.length === 0) continue;

		let proximity: 0 | 1 | 2;
		let relation: ServiceProximityResult["relation"];
		if (affected.has(key)) {
			proximity = 0;
			relation = "self";
		} else if (deps.has(key)) {
			proximity = 1;
			relation = "dependency";
		} else if (dependents.has(key)) {
			proximity = 1;
			relation = "dependent";
		} else {
			proximity = 2;
			relation = "beyond";
		}
		results.push({ serviceName: name, proximity, relation, hypothesisIndexes });
	}

	return results.sort(
		(a, b) =>
			a.proximity - b.proximity || a.serviceName.localeCompare(b.serviceName),
	);
}

// =============================================================================
// (c) SIMILARITY — Jaccard on alert labels + service/category bonuses
// =============================================================================

/** Build an incident's alert-label set: `key=value` entries plus a title token. */
export function buildLabelSet(
	alerts: Array<{ title: string; labels: Record<string, string> | null }>,
): Set<string> {
	const set = new Set<string>();
	for (const a of alerts) {
		if (a.labels) {
			for (const [k, v] of Object.entries(a.labels)) {
				set.add(`${k}=${v}`.toLowerCase());
			}
		}
		if (a.title?.trim()) set.add(`title:${a.title.trim().toLowerCase()}`);
	}
	return set;
}

/** Jaccard index |A∩B| / |A∪B|; 0 for two empty sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}

export interface SimilarityInput {
	labels: Set<string>;
	serviceId: string | null;
	rootCauseCategory: string | null;
}

export interface SimilarityFactors {
	score: number;
	jaccard: number;
	sameService: boolean;
	sharedCategory: boolean;
}

const SAME_SERVICE_BONUS = 0.2;
const SHARED_CATEGORY_BONUS = 0.1;

/**
 * Deterministic incident-vs-incident similarity: Jaccard on alert-label sets plus
 * a same-affected-service bonus and a shared-root-cause-category bonus, clamped to
 * [0,1].
 */
export function scoreSimilarity(
	current: SimilarityInput,
	past: SimilarityInput,
): SimilarityFactors {
	const j = jaccard(current.labels, past.labels);
	const sameService =
		current.serviceId !== null && current.serviceId === past.serviceId;
	const sharedCategory =
		current.rootCauseCategory !== null &&
		current.rootCauseCategory === past.rootCauseCategory;
	const score = Math.min(
		1,
		j +
			(sameService ? SAME_SERVICE_BONUS : 0) +
			(sharedCategory ? SHARED_CATEGORY_BONUS : 0),
	);
	return { score, jaccard: j, sameService, sharedCategory };
}

export interface PastIncidentInput {
	incidentId: string;
	incidentNumber: number;
	title: string;
	similarity: SimilarityInput;
}

export interface SimilarIncidentResult {
	incidentId: string;
	incidentNumber: number;
	title: string;
	score: number;
	factors: { jaccard: number; sameService: boolean; sharedCategory: boolean };
}

export interface SelectSimilarOptions {
	k: number;
	threshold: number;
}

export const DEFAULT_SIMILAR_OPTIONS: SelectSimilarOptions = {
	k: 5,
	threshold: 0.3,
};

/**
 * Score `current` against every `past` incident, keep those at or above the
 * threshold, and return the top-K by score (ties broken by higher incident number
 * for stable ordering).
 */
export function selectSimilarIncidents(
	current: SimilarityInput,
	past: PastIncidentInput[],
	opts: SelectSimilarOptions = DEFAULT_SIMILAR_OPTIONS,
): SimilarIncidentResult[] {
	return past
		.map((p) => {
			const f = scoreSimilarity(current, p.similarity);
			return {
				incidentId: p.incidentId,
				incidentNumber: p.incidentNumber,
				title: p.title,
				score: f.score,
				factors: {
					jaccard: f.jaccard,
					sameService: f.sameService,
					sharedCategory: f.sharedCategory,
				},
			};
		})
		.filter((r) => r.score >= opts.threshold)
		.sort((a, b) => b.score - a.score || b.incidentNumber - a.incidentNumber)
		.slice(0, opts.k);
}

/** 0..1 float → the 0-100 integer stored on IncidentSimilarity.similarityScore. */
export function toStoredScore(score: number): number {
	return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
