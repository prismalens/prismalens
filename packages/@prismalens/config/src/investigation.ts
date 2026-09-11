// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation timeouts and caps shared by the engine and the API. Pure: no
 * `process.env` reads, safe on the `@prismalens/config/investigation` subpath.
 */
export { ensureAppDataDir, getAppDataDir } from "./utils/app-data.js";

/** ACP cold-start headroom: the first handshake (spawn + model warm-up) is slow. */
export const HARNESS_INIT_TIMEOUT_MS = 120_000;
/** Per-prompt timeout for a harness turn. */
export const HARNESS_PROMPT_TIMEOUT_MS = 180_000;
/**
 * Wall-clock cap for a whole sandboxed harness run on the server (ADR-0020 resource
 * limits — the sandbox SIGKILLs the child past it). 15 min: generous enough for a
 * multi-step read-only investigation, tight enough to stop a wedged run from pinning
 * a worker slot forever. Unlike the CLI (opt-in via `agent.limits`), server runs are
 * unattended, so a sane default is the safe posture. Best-effort per provider.
 */
export const HARNESS_WALL_CLOCK_MS = 900_000;

/** Canonical-event preview/transcript caps (shared by adapters + the transcript). */
export const PREVIEW_LIMIT = 4000;
export const PREVIEW_CAP = 1200;
export const TRANSCRIPT_CAP = 24_000;

/** Convenience bundle of the investigation fallbacks. */
export const INVESTIGATION_DEFAULTS = {
	harnessInitTimeoutMs: HARNESS_INIT_TIMEOUT_MS,
	harnessPromptTimeoutMs: HARNESS_PROMPT_TIMEOUT_MS,
	harnessWallClockMs: HARNESS_WALL_CLOCK_MS,
	previewLimit: PREVIEW_LIMIT,
	previewCap: PREVIEW_CAP,
	transcriptCap: TRANSCRIPT_CAP,
} as const;
