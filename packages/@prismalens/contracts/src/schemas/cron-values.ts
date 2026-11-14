// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

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
