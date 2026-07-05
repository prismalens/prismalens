// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation defaults — the single home for the FALLBACK values the engine's
 * inputs need when `pl.config.yaml` omits them (review candidate #1; the
 * packaging/topology note). The user's real sources (repos, telemetry URLs) come
 * from their config — these are only the fallbacks.
 *
 * PURE: no `process.env` reads, no server schemas — safe to import from the engine,
 * CLI, and web worker via the `@prismalens/config/investigation` subpath WITHOUT
 * pulling in `getConfig()` (keeps the standalone CLI server-config-free, ADR-0011).
 *
 * Consolidates three drifted copies that had produced live bugs:
 *  - one `apiUrl` (`:5000`, not the `:3000` the `init` scaffold mistakenly used),
 *  - one OpenAI-compatible base URL (WITH `/v1`, which the Vercel AI SDK needs),
 *  - one `~/.prismalens` via {@link getAppDataDir} (which honors PRISMALENS_USER_FOLDER).
 */
export { ensureAppDataDir, getAppDataDir } from "./utils/app-data.js";

/** Read-only telemetry + app surfaces the harness queries (host-local fallbacks). */
export const TELEMETRY_DEFAULTS = {
	prometheusUrl: "http://localhost:9090",
	alertmanagerUrl: "http://localhost:9093",
	apiUrl: "http://localhost:5000",
} as const;

/**
 * Tier-1 reduce synthesis default endpoint (OpenAI-compatible, BYO-key — ADR-0006).
 * The default MODEL is per-provider now (ADR-0013 default-model strategy): see
 * `getDefaultModel` in `@prismalens/config/llm` — there is no universal model here.
 */
export const SYNTH_DEFAULTS = {
	/** OpenAI-compatible endpoint — note the `/v1`, which the AI SDK requires. */
	baseURL: "https://ollama.com/v1",
} as const;

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
	telemetry: TELEMETRY_DEFAULTS,
	synth: SYNTH_DEFAULTS,
	harnessInitTimeoutMs: HARNESS_INIT_TIMEOUT_MS,
	harnessPromptTimeoutMs: HARNESS_PROMPT_TIMEOUT_MS,
	harnessWallClockMs: HARNESS_WALL_CLOCK_MS,
	previewLimit: PREVIEW_LIMIT,
	previewCap: PREVIEW_CAP,
	transcriptCap: TRANSCRIPT_CAP,
} as const;
