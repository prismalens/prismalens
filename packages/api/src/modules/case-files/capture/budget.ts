// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Capture budgets. Every value below is an assumption to revisit with pilot
 * evidence; none was measured before the slice shipped.
 */

const MiB = 1024 * 1024;

/** Assumption: one whole capture, identity through logs. */
export const CAPTURE_DEADLINE_MS = 60_000;
/** Assumption: one kubectl command. */
export const COMMAND_TIMEOUT_MS = 15_000;
/** Assumption: stdout kept per command before the tree is killed. */
export const COMMAND_BYTE_CAP = 8 * MiB;

/** Assumption: `--tail` lines per previous-container log. */
export const LOG_TAIL = 500;
/** Assumption: `--limit-bytes` per previous-container log. */
export const LOG_LIMIT_BYTES = 1 * MiB;
/** Assumption: crashed containers whose logs are fetched. */
export const MAX_LOG_CONTAINERS = 5;

/** Assumption: queued captures before the lowest-ranked is skipped. */
export const QUEUE_CAPACITY = 16;
/** Assumption: captures running at once. */
export const MAX_RUNNING = 2;
/** Assumption: attempts when every command errored. */
export const MAX_ATTEMPTS = 2;
/** Assumption: wait before the retry. */
export const RETRY_DELAY_MS = 15_000;

/** Assumption: a capture started this long after its due time is missed(interval). */
export const MISSED_AFTER_MS = 300_000;
/** Assumption: stored bytes per binding before retention expires the oldest. */
export const RETENTION_BYTES_PER_BINDING = 256 * MiB;
/** Assumption: age past which artifacts expire. */
export const RETENTION_DAYS = 30;

/** Assumption: how far before the alert a change is a candidate cause. */
export const WINDOW_BEFORE_ALERT_MS = 7_200_000;
/** Assumption: newest Warning events kept per capture. */
export const MAX_WARNING_EVENTS = 50;
/** Assumption: queue tick interval. */
export const TICK_MS = 2_000;
