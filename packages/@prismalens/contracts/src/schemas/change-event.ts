/**
 * Change Event schema — matches DB model (ChangeEvent table)
 * Tracks deployments, config changes, commits, and rollbacks
 * that may correlate with incidents.
 */
import { z } from "zod";
import { ChangeEventTypeSchema, DateStringSchema } from "./common.js";

export const ChangeEventSchema = z.object({
	id: z.string().uuid(),
	type: ChangeEventTypeSchema,
	source: z.string(),
	timestamp: DateStringSchema,
	serviceId: z.string().uuid().nullable(),
	description: z.string().nullable(),
	metadata: z.record(z.unknown()).nullable(),
	riskScore: z.number().int().min(0).max(100).nullable(),
	createdAt: DateStringSchema,
});

export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
