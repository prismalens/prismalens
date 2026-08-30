// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/config/harness-selection
 *
 * The ONE answer to "would an investigation actually start with this
 * configuration?" (ADR-0031).
 *
 * It used to be answered twice — once by the worker's job-time gate, once by the
 * API for the setup step and the Settings picker — from different inputs. Four
 * defects came out of that gap in a row (#501, #517, #518): a badge saying usable
 * for a job the worker refuses, a warning against a config that works, and a setup
 * step going green on one the worker throws on. The worker is the behaviour of
 * record because it is what refuses the job, so its logic lives here and the
 * worker calls it too. Nothing may re-derive this.
 *
 * Node-side: `resolveHarnessAuth` reads PATH and the session file.
 */
import { type HarnessAuthVerdict, resolveHarnessAuth } from "./harness-auth.js";
import {
	HARNESS_AUTO_ORDER,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessAuthRoute,
	type HarnessId,
} from "./providers/harness.js";
import type { LLMProviderId } from "./providers/llm.js";

/**
 * deepagents only speaks the OpenAI protocol (ADR-0013 scope boundary): it is
 * driven through `OPENAI_*` env, so a non-OpenAI-shaped provider's key would be
 * handed over unusable and silently mis-wire the harness.
 */
export function speaksOpenAiProtocol(provider: LLMProviderId): boolean {
	return (
		provider === "openai" || provider === "ollama" || provider === "custom"
	);
}

/** Why no investigation would start. */
export type HarnessSelectionFailure =
	| "invalid-env-harness"
	| "no-compatible-harness"
	| "protocol-mismatch"
	| "harness-unauthenticated"
	| "llm-not-configured";

export type HarnessSelection =
	| {
			runnable: true;
			harness: HarnessId;
			route: HarnessAuthRoute;
			/** False only for a cli-session with no credentials file to prove it. */
			verified: boolean;
			/** The harness was chosen by `auto`, not pinned. */
			auto: boolean;
	  }
	| {
			runnable: false;
			failure: HarnessSelectionFailure;
			/** The message the worker throws. Callers render it; none rewrite it. */
			reason: string;
			/** The harness the failure is about, where one was determined. */
			harness?: HarnessId;
	  };

export interface HarnessSelectionInput {
	/** The ACTIVE Tier-1 provider, or null when none is configured. */
	provider: LLMProviderId | null;
	/**
	 * The ACTIVE provider's resolved credential — never a key stored for some
	 * other provider. A key for a provider that is not active buys nothing, and
	 * treating it as if it did is exactly #517.
	 */
	apiKey: string;
	/** The active provider's model id; empty or null when none is picked. */
	model: string | null;
	/** The persisted harness setting. */
	harness: "auto" | HarnessId;
	/** `PRISMALENS_HARNESS`, the dev/ops override. Validated, not trusted. */
	envHarness?: string;
	/** Injected for hermetic tests; defaults read the real machine. */
	auth?: { homeDir?: string; isOnPath?: (bin: string) => boolean };
}

/**
 * Is a harness allowed to serve this provider at all? Separate from whether it
 * has a credential — a compatible harness with no key and an incompatible one
 * with a key fail for different reasons and get different messages.
 */
function providerCompatible(
	harness: HarnessId,
	provider: LLMProviderId | null,
): boolean {
	if (harness === "deepagents") {
		return provider !== null && speaksOpenAiProtocol(provider);
	}
	if (harness === "claude-code") {
		return provider === "anthropic" || provider === null;
	}
	return true;
}

/**
 * Does this harness hold a key it can actually use? Scoped to the active
 * provider, because that is the only credential the worker ever hands over.
 */
function harnessKeyPresent(
	harness: HarnessId,
	provider: LLMProviderId | null,
	apiKey: string,
): boolean {
	if (!apiKey) return false;
	if (harness === "deepagents") {
		return provider !== null && speaksOpenAiProtocol(provider);
	}
	if (harness === "claude-code") {
		return provider === "anthropic" || provider === null;
	}
	return true;
}

/**
 * The auth verdict for ONE harness under this configuration, with `apiKeyPresent`
 * scoped exactly as the gate scopes it. Exported so the Settings picker cannot
 * invent a different answer than the run would give — that gap is #517.
 */
export function resolveHarnessAuthFor(
	harness: HarnessId,
	input: HarnessSelectionInput,
): HarnessAuthVerdict {
	return resolveHarnessAuth(harness, {
		apiKeyPresent: harnessKeyPresent(harness, input.provider, input.apiKey),
		homeDir: input.auth?.homeDir,
		isOnPath: input.auth?.isOnPath,
	});
}

/** Walk `HARNESS_AUTO_ORDER` for the first harness that could run (ADR-0021). */
function pickAuto(
	input: HarnessSelectionInput,
): { harness: HarnessId } | { reason: string } {
	for (const harnessId of HARNESS_AUTO_ORDER) {
		const descriptor = HARNESS_REGISTRY[harnessId];
		if (!descriptor?.implemented) continue;
		if (!providerCompatible(harnessId, input.provider)) continue;

		const verdict = resolveHarnessAuth(harnessId, {
			apiKeyPresent: harnessKeyPresent(harnessId, input.provider, input.apiKey),
			homeDir: input.auth?.homeDir,
			isOnPath: input.auth?.isOnPath,
		});
		if (verdict.usable) return { harness: harnessId };
	}

	// claude-code's remedy is the most actionable, so it is what the user sees
	// when nothing at all resolved.
	const claudeVerdict = resolveHarnessAuth("claude-code", {
		apiKeyPresent: harnessKeyPresent(
			"claude-code",
			input.provider,
			input.apiKey,
		),
		homeDir: input.auth?.homeDir,
		isOnPath: input.auth?.isOnPath,
	});
	return {
		reason: claudeVerdict.usable
			? "No compatible harness found."
			: claudeVerdict.reason,
	};
}

/**
 * Resolve the harness an investigation would run on, or the reason none would.
 * Order and messages are the worker's, verbatim — this function IS the gate.
 */
export function resolveHarnessSelection(
	input: HarnessSelectionInput,
): HarnessSelection {
	if (
		input.envHarness !== undefined &&
		!(HARNESS_IDS as readonly string[]).includes(input.envHarness)
	) {
		return {
			runnable: false,
			failure: "invalid-env-harness",
			reason: `Invalid PRISMALENS_HARNESS="${input.envHarness}" — expected one of ${HARNESS_IDS.join("|")}.`,
		};
	}
	const envHarness = input.envHarness as HarnessId | undefined;

	let harness: HarnessId;
	if (envHarness) {
		harness = envHarness;
	} else if (input.harness !== "auto") {
		harness = input.harness;
	} else {
		const picked = pickAuto(input);
		if ("reason" in picked) {
			return {
				runnable: false,
				failure: "no-compatible-harness",
				reason: picked.reason,
			};
		}
		harness = picked.harness;
	}

	if (
		harness === "deepagents" &&
		(!input.provider || !speaksOpenAiProtocol(input.provider))
	) {
		return {
			runnable: false,
			failure: "protocol-mismatch",
			harness,
			reason:
				`Harness "deepagents" only supports OpenAI-protocol providers ` +
				`(openai/ollama/custom); active provider is "${input.provider}". ` +
				`Switch provider or set PRISMALENS_HARNESS to a harness that ` +
				`supports it (e.g. claude-code for anthropic).`,
		};
	}

	const verdict = resolveHarnessAuth(harness, {
		apiKeyPresent: harnessKeyPresent(harness, input.provider, input.apiKey),
		homeDir: input.auth?.homeDir,
		isOnPath: input.auth?.isOnPath,
	});
	if (!verdict.usable) {
		return {
			runnable: false,
			failure: "harness-unauthenticated",
			harness,
			reason: verdict.reason,
		};
	}

	// A cli-session run needs no Tier-1 provider or model — the harness carries
	// its own, and the report comes back raw. Every other route needs both.
	const isSessionRoute = verdict.route === "cli-session";
	if ((!input.provider || !input.model) && !isSessionRoute) {
		return {
			runnable: false,
			failure: "llm-not-configured",
			harness,
			reason:
				"LLM not configured: no active provider/model. Configure via Settings " +
				"or set PRISMALENS_LLM_PROVIDER + PRISMALENS_LLM_MODEL.",
		};
	}

	return {
		runnable: true,
		harness,
		route: verdict.route,
		verified: isSessionRoute ? verdict.verified : true,
		auto: !envHarness && input.harness === "auto",
	};
}
