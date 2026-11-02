// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads on a project, a service, or nothing at all (#1020): a chat that is not
 * an incident's. Incident and schedule threads keep their own routes.
 */
import { z } from "zod";
import {
	AttachmentIdsSchema,
	InvestigationSchema,
	RunChoiceSchema,
} from "./investigation.js";
import { AccessLevelSchema } from "./settings.js";

export const ThreadStartSubjectSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("project"), repositoryId: z.string().uuid() }),
	z.object({ kind: z.literal("service"), serviceId: z.string().uuid() }),
	z.object({ kind: z.literal("none") }),
]);
export type ThreadStartSubject = z.infer<typeof ThreadStartSubjectSchema>;

/** Body of `POST /threads`: the first message starts the thread's run. */
export const StartThreadSchema = z.object({
	subject: ThreadStartSubjectSchema,
	text: z.string().trim().min(1).max(4000),
	accessLevel: AccessLevelSchema.optional(),
	...RunChoiceSchema.shape,
	/** Uploaded first with `POST /threads/drafts/{draftKey}/attachments`. */
	attachments: AttachmentIdsSchema.optional(),
	draftKey: z.string().uuid().optional(),
});
export type StartThreadInput = z.infer<typeof StartThreadSchema>;

export const StartThreadResponseSchema = z.object({
	investigationId: z.string().uuid(),
	jobId: z.string().nullable(),
	queued: z.boolean(),
});

export const ThreadListQuerySchema = z.object({
	repositoryId: z.string().uuid().optional(),
	serviceId: z.string().uuid().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ThreadListSchema = z.object({
	data: z.array(InvestigationSchema),
});

export const UploadDraftAttachmentSchema = z.object({
	draftKey: z.string().uuid(),
	file: z.file(),
});

export const UploadThreadAttachmentSchema = z.object({
	id: z.string().uuid(),
	file: z.file(),
});
