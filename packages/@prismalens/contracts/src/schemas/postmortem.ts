/**
 * Postmortem schemas
 */
import { z } from "zod";
import { DateStringSchema, PostmortemStatusSchema } from "./common.js";

// =============================================================================
// POSTMORTEM SCHEMAS
// =============================================================================

export const PostmortemSchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	title: z.string().nullable(),
	summary: z.string().nullable(),
	timeline: z.string().nullable(), // JSON array
	whatHappened: z.string().nullable(),
	whyItHappened: z.string().nullable(),
	whatWeLearned: z.string().nullable(),
	actionItems: z.string().nullable(), // JSON array
	customerImpact: z.string().nullable(),
	financialImpact: z.number().nullable(),
	status: PostmortemStatusSchema,
	authorId: z.string().uuid().nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
	publishedAt: DateStringSchema.nullable(),
});

export const CreatePostmortemSchema = z.object({
	incidentId: z.string().uuid(),
	title: z.string().optional(),
	autoPopulate: z.boolean().optional(), // Auto-fill from AI investigation
});

export const UpdatePostmortemSchema = z.object({
	title: z.string().optional(),
	summary: z.string().optional(),
	timeline: z.string().optional(),
	whatHappened: z.string().optional(),
	whyItHappened: z.string().optional(),
	whatWeLearned: z.string().optional(),
	actionItems: z.string().optional(),
	customerImpact: z.string().optional(),
	financialImpact: z.number().optional(),
	status: PostmortemStatusSchema.optional(),
});

// =============================================================================
// POSTMORTEM WITH RELATIONS
// =============================================================================

// Author reference
const AuthorRefSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	name: z.string().nullable(),
});

export const PostmortemWithRelationsSchema = PostmortemSchema.extend({
	author: AuthorRefSchema.nullable().optional(),
});

// =============================================================================
// ACTION ITEM SCHEMA (for parsing actionItems JSON)
// =============================================================================

export const ActionItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	priority: z.enum(["low", "medium", "high", "critical"]).optional(),
	completed: z.boolean(),
	assignee: z.string().optional(),
	dueDate: z.string().optional(),
});

export const ActionItemsArraySchema = z.array(ActionItemSchema);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Postmortem = z.infer<typeof PostmortemSchema>;
export type CreatePostmortemInput = z.infer<typeof CreatePostmortemSchema>;
export type UpdatePostmortemInput = z.infer<typeof UpdatePostmortemSchema>;
export type PostmortemWithRelations = z.infer<
	typeof PostmortemWithRelationsSchema
>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
