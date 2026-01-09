/**
 * Timeline entry schemas
 */
import { z } from "zod";
import {
	DateStringSchema,
	TimelineEntryTypeSchema,
	TimelineSourceSchema,
} from "./common.js";

// =============================================================================
// TIMELINE ENTRY SCHEMAS
// =============================================================================

export const TimelineEntrySchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	type: TimelineEntryTypeSchema,
	title: z.string().min(1),
	description: z.string().nullable(),
	metadata: z.record(z.unknown()).nullable(),
	source: TimelineSourceSchema,
	userId: z.string().uuid().nullable(),
	occurredAt: DateStringSchema,
});

export const CreateTimelineEntrySchema = z.object({
	incidentId: z.string().uuid(),
	type: TimelineEntryTypeSchema,
	title: z.string().min(1),
	description: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
	source: TimelineSourceSchema.optional(),
});

// =============================================================================
// TIMELINE WITH RELATIONS
// =============================================================================

const UserRefSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
});

export const TimelineEntryWithRelationsSchema = TimelineEntrySchema.extend({
	user: UserRefSchema.nullable().optional(),
});

// =============================================================================
// TIMELINE QUERY SCHEMAS
// =============================================================================

export const TimelineQuerySchema = z.object({
	incidentId: z.string().uuid(),
	type: TimelineEntryTypeSchema.optional(),
	source: TimelineSourceSchema.optional(),
	limit: z.coerce.number().int().min(1).max(200).default(100),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type CreateTimelineEntryInput = z.infer<
	typeof CreateTimelineEntrySchema
>;
export type TimelineEntryWithRelations = z.infer<
	typeof TimelineEntryWithRelationsSchema
>;
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;
