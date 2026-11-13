// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's cron jobs (#1024 surface F): a recurring prompt the agent set on
 * its own thread with `pl_cron_create`. Unlike a Schedule, a fire messages this
 * thread instead of starting a new run.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { DateStringSchema } from "./common.js";

/** Jobs one thread may hold at once. */
export const CRON_JOBS_MAX = 3;
/** Least time between two fires of one job. */
export const CRON_MIN_GAP_MINUTES = 60;
/** A recurring job expires this long after creation, after one last fire. */
export const CRON_EXPIRES_DAYS = 7;
/** `pl_cron_create` is refused when the user has not written in the thread for this long. */
export const CRON_USER_QUIET_DAYS = 7;
export const CRON_PROMPT_MAX = 2000;
export const CRON_NAME_MAX = 80;

export const CronCreateInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** Five-field cron in the host's local time zone. */
		schedule: z.string().trim().min(9).max(100),
		prompt: z.string().trim().min(1).max(CRON_PROMPT_MAX),
		name: z.string().trim().min(1).max(CRON_NAME_MAX).optional(),
		recurring: z.boolean().default(true),
	}),
);
export type CronCreateInput = z.infer<typeof CronCreateInputSchema>;

export const CronJobSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string(),
		name: z.string(),
		schedule: z.string(),
		prompt: z.string(),
		recurring: z.boolean(),
		/** The next fire; null once a one-shot job has fired. */
		next: DateStringSchema.nullable(),
		/** null for a one-shot job. */
		expires: DateStringSchema.nullable(),
		/** A fire is waiting for the thread's next pause or resume. */
		pending: z.boolean(),
		lastFiredAt: DateStringSchema.nullable(),
		/** Fires skipped because this job's previous fire was still pending. */
		skipped: z.number().int().nonnegative(),
		createdAt: DateStringSchema,
	}),
);
export type CronJob = z.infer<typeof CronJobSchema>;

/** `GET /threads/{id}/cron`: the thread's Scheduled section. */
export const ThreadCronSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		jobs: z.array(CronJobSchema).max(CRON_JOBS_MAX),
	}),
);
export type ThreadCron = z.infer<typeof ThreadCronSchema>;

export const DeleteCronJobSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		jobId: z.string().min(1).max(100),
	}),
);
