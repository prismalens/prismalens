// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Event schemas (raw incoming signals)
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// EVENT SCHEMAS
// =============================================================================

export const EventSchema = z.object({
	id: z.string().uuid(),
	source: z.string(), // prometheus, github, render, generic
	sourceEventId: z.string().nullable(),
	eventType: z.string(), // alert, deployment, commit
	payload: z.string(), // Full raw JSON string
	receivedAt: DateStringSchema,
	eventTime: DateStringSchema.nullable(),
	processed: z.boolean(),
	alertId: z.string().uuid().nullable(),
});

export const CreateEventSchema = z.object({
	source: z.string(),
	sourceEventId: z.string().optional(),
	eventType: z.string(),
	payload: z.record(z.unknown()),
	eventTime: z.string().datetime().optional(),
});

// =============================================================================
// EVENT QUERY SCHEMAS
// =============================================================================

export const EventQuerySchema = z.object({
	source: z.string().optional(),
	eventType: z.string().optional(),
	processed: z.coerce.boolean().optional(),
	alertId: z.string().uuid().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Event = z.infer<typeof EventSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type EventQuery = z.infer<typeof EventQuerySchema>;
