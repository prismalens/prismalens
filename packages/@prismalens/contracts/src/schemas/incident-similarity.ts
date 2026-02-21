/**
 * Incident Similarity schema — matches DB model (IncidentSimilarity table)
 * Pre-calculated similarity scores for pattern matching between incidents.
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

export const IncidentSimilaritySchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	similarIncidentId: z.string().uuid(),
	similarityScore: z.number().int().min(0).max(100),
	matchFactors: z.record(z.unknown()).nullable(),
	calculatedAt: DateStringSchema,
});

export type IncidentSimilarity = z.infer<typeof IncidentSimilaritySchema>;
