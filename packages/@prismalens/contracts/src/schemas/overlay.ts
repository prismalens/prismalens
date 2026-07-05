/**
 * Reduce overlay schema (ADR-0016 §5c — "the moat").
 *
 * The overlay is APP-SIDE post-report enrichment computed BESIDE the canonical
 * engine report when an investigation result is persisted (ADR-0011 keeps the
 * ENGINE db-clean — none of this lives in @prismalens/engine). It is deterministic
 * — NO LLM: keyword correlation against the deploy/change timeline, service-graph
 * proximity ranking, and Jaccard similarity vs past incidents.
 *
 * Persisted as JSON on `Investigation.overlay` and surfaced on the investigation
 * GET payload so the UI can render "related changes & similar incidents"
 * type-safely. Absent (null) until the overlay has been computed for a run.
 */
import { z } from "zod";

/**
 * A deploy/change-timeline row (Deployment or ChangeEvent) that a report
 * hypothesis references — matched deterministically on the affected service name
 * or a deploy/change identifier appearing in the hypothesis text/evidence.
 */
export const MatchedChangeSchema = z.object({
	/** Which timeline table this row came from. */
	kind: z.enum(["deployment", "change_event"]),
	/** Row id (Deployment.id or ChangeEvent.id). */
	id: z.string(),
	/** Human label — deployment name or change description. */
	title: z.string(),
	/** Origin — the change source (e.g. "render", "github") or "deployment". */
	source: z.string(),
	/** Affected service name for this row, when known. */
	serviceName: z.string().nullable(),
	/** When the change/deploy happened (ISO). */
	timestamp: z.string(),
	/** Index into the report's ordered `hypotheses` this row matched. */
	hypothesisIndex: z.number().int().min(0),
	/** The literal token (service name or identifier) that produced the match. */
	matchedOn: z.string(),
});
export type MatchedChange = z.infer<typeof MatchedChangeSchema>;

/**
 * A service named in a hypothesis, ranked by its distance from the incident's
 * affected service in the service-dependency graph. proximity: 0=self,
 * 1=direct dependency/dependent, 2=beyond.
 */
export const ServiceProximitySchema = z.object({
	serviceName: z.string(),
	proximity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
	relation: z.enum(["self", "dependency", "dependent", "beyond"]),
	/** Indices into the report's ordered `hypotheses` that name this service. */
	hypothesisIndexes: z.array(z.number().int().min(0)),
});
export type ServiceProximity = z.infer<typeof ServiceProximitySchema>;

/**
 * A past incident scored similar to this one, deterministically: Jaccard on the
 * incidents' alert-label sets + a same-service bonus + a shared-root-cause-category
 * bonus. Mirrors the top-K written back to `IncidentSimilarity` (score there is the
 * 0-100 int; here it is the normalised 0..1 float for display).
 */
export const SimilarIncidentSchema = z.object({
	incidentId: z.string(),
	incidentNumber: z.number().int(),
	title: z.string(),
	/** Normalised 0..1 similarity. */
	score: z.number().min(0).max(1),
	factors: z.object({
		jaccard: z.number().min(0).max(1),
		sameService: z.boolean(),
		sharedCategory: z.boolean(),
	}),
});
export type SimilarIncident = z.infer<typeof SimilarIncidentSchema>;

export const OverlaySchema = z.object({
	matchedChanges: z.array(MatchedChangeSchema),
	serviceProximity: z.array(ServiceProximitySchema),
	similarIncidents: z.array(SimilarIncidentSchema),
	/** When the overlay was computed (ISO). */
	computedAt: z.string(),
});
export type Overlay = z.infer<typeof OverlaySchema>;
