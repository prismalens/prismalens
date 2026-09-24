// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness registry: every harness speaks ACP over stdio (ADR 0003). Any row on
 * PATH is selectable; `tested` records the version a compatibility run passed on.
 */
export const HARNESS_IDS = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * Every way `resolveHarnessSelection` can refuse, and the only ones the API can
 * put in a PRECONDITION_FAILED payload. This is the single source of truth:
 * `HarnessSelectionFailure` and the contract's `HarnessSelectionFailureSchema`
 * are both derived from it, so the two cannot drift apart again. It lives here,
 * beside the registry, because this module is pure data — the selection logic
 * imports `node:fs`, and the contracts package is bundled for the browser.
 */
export const HARNESS_SELECTION_FAILURES = [
	/** PRISMALENS_HARNESS names something that is not a registry id. */
	"invalid-env-harness",
	/** A pin (env or persisted) names a real harness whose binary is absent. */
	"pinned-harness-missing",
	/** No registry harness is on PATH. */
	"no-harness",
	/** A model is set for a harness that has no way to take one (#639 rec 4). */
	"model-unsupported",
] as const;
export type HarnessSelectionFailure =
	(typeof HARNESS_SELECTION_FAILURES)[number];

export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/**
 * Per-run environment for the harness child. Config is isolated to what
 * prismalens generates; the user's own login and data home stay reachable
 * (ADR 0003 §2: prismalens never touches harness credentials).
 */
export interface HarnessRunEnv {
	configDir: string;
	/** Empty per-run dir a harness can be pointed at for config it would otherwise read from the user's home. */
	dataDir: string;
	cwd: string;
	/** Model id in the harness's own format, when the operator set one; otherwise the harness default. */
	model?: string;
	/** Absolute path of the row's `companionBinary` on PATH, when found. */
	companionPath?: string;
}

export interface HarnessDescriptor {
	id: HarnessId;
	label: string;
	/** Binary looked up on PATH for detection. */
	binary: string;
	/**
	 * The vendor's own CLI the adapter drives, when it is a separate install. The
	 * doctor names it when the adapter is missing, and the run hands its PATH copy
	 * to the adapter so the adapter never ships a second one.
	 */
	companionBinary?: string;
	/** argv for `binary` that starts an ACP server on stdio in `cwd`. */
	acpArgs: (env: HarnessRunEnv) => string[];
	/** Env vars that point the harness at prismalens's per-run config, never the user's. */
	acpEnv: (env: HarnessRunEnv) => Record<string, string>;
	/** Files prismalens writes under configDir before the run; the harness reads nothing else. */
	configFiles?: (env: HarnessRunEnv) => Record<string, string>;
	/** `_meta` on ACP `session/new`, for isolation a harness takes only there. */
	sessionMeta?: () => Record<string, unknown>;
	/** One line the doctor prints when the binary is missing. */
	install: string;
	/**
	 * The model prismalens asks for when the operator set none: the id the
	 * row's compatibility run passed on. Absent means the harness's own default,
	 * which nobody tested (#337 run e: OpenCode's default ignored the report
	 * schema twice). Recorded per run with its source in `RunFidelity`.
	 */
	defaultModel?: string;
	readOnlyFidelity: PermissionFidelity;
	readOnlyMechanism: string;
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. Written by hand from `scripts/acp-admission.ts` output; CI re-runs it on every push for rows with a keyless model. */
	tested?: { version: string; date: string };
	/**
	 * How `HarnessRunEnv.model` reaches the harness: `config` (a file
	 * `configFiles` writes), `env` (a var `acpEnv` sets), or `unsupported` (the
	 * harness has no way to take it, so an operator-set model refuses the run
	 * before it starts; see `refuseModel`).
	 */
	modelVia: "config" | "env" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/**
	 * Provider API-key env vars this harness actually reads from the host
	 * (ADR 0004 §5: allowlist, never `process.env`). Never a bare wildcard —
	 * each name is cited in the row's own doc pointer below.
	 */
	providerKeys?: readonly string[];
}

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> = {
	opencode: {
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		acpArgs: ({ cwd }) => ["acp", "--pure", "--cwd", cwd],
		acpEnv: ({ configDir, dataDir }) => ({
			XDG_CONFIG_HOME: dataDir,
			OPENCODE_CONFIG_DIR: configDir,
			// The repo's own opencode.json, plugins and CLAUDE.md-style files stay inert (ADR 0004 §1; #639 R4).
			OPENCODE_DISABLE_PROJECT_CONFIG: "1",
			OPENCODE_DISABLE_CLAUDE_CODE: "1",
		}),
		configFiles: ({ model }) => ({
			"opencode.json": JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					...(model ? { model } : {}),
					permission: {
						edit: "ask",
						bash: "ask",
						webfetch: "deny",
						websearch: "deny",
						external_directory: "deny",
					},
					// Without it a refused tool ends the turn, so a read-only run rarely reaches its report (#639 finding 1).
					experimental: { continue_loop_on_deny: true },
					share: "disabled",
				},
				null,
				2,
			),
		}),
		// opencode resolves ~75 provider catalogs via models.dev (models.dev/api.json);
		// most first-class ones also support `/connect`, whose auth.json lives under the
		// XDG data dir (Global.Path.data). XDG_DATA_HOME is not overridden here, so the
		// user's `/connect` login survives and no host env is needed for those. This
		// lists only the BYO-key env vars for the providers this repo documents elsewhere
		// in the registry (Anthropic,
		// OpenAI, Google/Gemini), per each provider's `env` field in that catalog,
		// plus OpenRouter as the common self-hosted gateway. Not exhaustive by
		// design (ADR 0004 §5 is an allowlist, not "every provider key that
		// exists"); extend this list deliberately, never with a wildcard.
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GEMINI_API_KEY",
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"GOOGLE_API_KEY",
			"OPENROUTER_API_KEY",
		],
		install:
			"curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai)",
		// The keyless model every #337 walk and the CI compatibility run used.
		defaultModel: "opencode/muse-spark-1.3-contributor-free",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism:
			"opencode.json permission edit/bash=ask answered by prismalens; webfetch, websearch, external_directory denied; repo config disabled",
		tested: { version: "1.18.30", date: "2026-09-20" },
		modelVia: "config",
		loginHint:
			"Keyless default model; `opencode auth login` or a provider key in env for others",
	},
	"claude-code": {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude-agent-acp",
		companionBinary: "claude",
		acpArgs: () => [],
		acpEnv: ({ model, companionPath }) => ({
			...(companionPath ? { CLAUDE_CODE_EXECUTABLE: companionPath } : {}),
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			// Claude Code reads the model from env; one model for every tier and sub-agent.
			...(model
				? {
						ANTHROPIC_MODEL: model,
						ANTHROPIC_DEFAULT_OPUS_MODEL: model,
						ANTHROPIC_DEFAULT_SONNET_MODEL: model,
						ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
						CLAUDE_CODE_SUBAGENT_MODEL: model,
					}
				: {}),
		}),
		// No project hooks, settings or .mcp.json from the snapshot (ADR 0004 §1; #639 R4).
		sessionMeta: () => ({ claudeCode: { options: { settingSources: [] } } }),
		// Anthropic SDK default env var (docs.anthropic.com).
		// ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN: Claude Code's documented gateway pair (LLM gateway, Ollama).
		providerKeys: [
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_AUTH_TOKEN",
		],
		install:
			"npm i -g @agentclientprotocol/claude-agent-acp --omit=optional  (then `claude /login`, or set ANTHROPIC_API_KEY on a server)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism:
			"ACP session/request_permission answered by prismalens; settingSources: [] keeps repo settings and hooks inert",
		// scripts/acp-admission.ts, 3 of 3 on Ollama gemma4:31b-cloud (#634).
		tested: { version: "0.81.1", date: "2026-09-23" },
		modelVia: "env",
		loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
	},
	codex: {
		id: "codex",
		label: "Codex",
		binary: "codex-acp",
		acpArgs: () => [],
		acpEnv: () => ({
			// codex-acp reads an env key only once the client picks its api-key method;
			// without this it answers -32000 when no login exists (codex-acp 1.13.1, #634).
			DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
			// codex-acp's own read-only mode, so the harness refuses writes before
			// prismalens's permission answer is asked (codex-acp readme-dev.md, #634).
			INITIAL_AGENT_MODE: "read-only",
		}),
		// codex-acp README: CODEX_API_KEY wins over OPENAI_API_KEY for the api-key method.
		providerKeys: ["CODEX_API_KEY", "OPENAI_API_KEY"],
		install:
			"npm i -g @agentclientprotocol/codex-acp  (then `codex login`, or set OPENAI_API_KEY on a server)",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism:
			"INITIAL_AGENT_MODE=read-only plus ACP permission answers (codex-acp 1.11.0 applied writes without a request in the #639 gate)",
		// 3 of 3 with a scratch HOME's ~/.codex on Ollama gemma4:31b-cloud (#634).
		tested: { version: "1.13.1", date: "2026-09-24" },
		modelVia: "unsupported",
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
	},
	gemini: {
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		acpArgs: () => ["--experimental-acp"],
		acpEnv: () => ({}),
		// Gemini CLI's documented API-key env var.
		providerKeys: ["GEMINI_API_KEY"],
		install: "npm i -g @google/gemini-cli",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: "ACP permission answers",
		modelVia: "unsupported",
		loginHint: "`gemini` sign-in, or `GEMINI_API_KEY` in env",
	},
	deepagents: {
		id: "deepagents",
		label: "deepagents",
		// deepagents-acp ships no console script; deepagents-code's `dcode --acp` is
		// the ACP server (entry points of deepagents-code 0.1.71 on PyPI, #634).
		// --no-mcp: no MCP servers from the snapshot or the user's config.
		binary: "dcode",
		acpArgs: () => ["--acp", "--no-mcp"],
		acpEnv: () => ({}),
		// The two keys `deepagents-acp --help` listed under ENVIRONMENT VARIABLES;
		// not yet re-checked against `dcode`, which may read more providers.
		providerKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
		install: "uv tool install -U deepagents-code --with deepagents-acp",
		readOnlyFidelity: "cooperative",
		readOnlyMechanism: "ACP permission answers; --no-mcp",
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		modelVia: "unsupported",
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
	},
};

/**
 * The child env for a harness invocation: the row's own `providerKeys` read out
 * of `sourceEnv` (the process floor's allowlist is layered on separately by
 * `buildChildEnv`). Never widens to "everything but PRISMALENS_*" (ADR 0004 §5)
 * and always drops a `PRISMALENS_*` name even if a row were ever misconfigured
 * to list one.
 */
export function getHarnessProviderKeys(
	harnessId: HarnessId,
	sourceEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const keys = HARNESS_REGISTRY[harnessId]?.providerKeys ?? [];
	const result: Record<string, string> = {};
	for (const key of keys) {
		if (key.startsWith("PRISMALENS_")) continue;
		const value = sourceEnv[key];
		if (value !== undefined) result[key] = value;
	}
	const base = result.ANTHROPIC_BASE_URL;
	if (base && !isSafeGatewayUrl(base))
		throw new Error(
			`ANTHROPIC_BASE_URL must be https unless it points at this machine: ${base}`,
		);
	return result;
}

/** A gateway receives the auth token, so plain http is allowed only on loopback. */
function isSafeGatewayUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	return (
		url.protocol === "http:" &&
		(host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host))
	);
}

/** Where a run's model id came from; recorded in `RunFidelity` (#337 run e, G11). */
export const MODEL_SOURCES = [
	"operator",
	"product-default",
	"harness-default",
] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface ResolvedModel {
	/** The id passed to the harness; undefined leaves the harness to its own default. */
	model?: string;
	source: ModelSource;
}

/** Operator setting first, then the row's tested default, then the harness's own. */
export function resolveHarnessModel(
	harnessId: HarnessId,
	operatorModel?: string,
): ResolvedModel {
	const operator = operatorModel?.trim();
	if (operator) return { model: operator, source: "operator" };
	const row = HARNESS_REGISTRY[harnessId]?.defaultModel;
	if (row) return { model: row, source: "product-default" };
	return { source: "harness-default" };
}

/** Auto-selection order: the first one on PATH runs unless one is pinned. */
export const HARNESS_AUTO_ORDER: readonly HarnessId[] = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
];

export const HARNESS_BINARY: Record<HarnessId, string> = Object.fromEntries(
	HARNESS_IDS.map((id) => [id, HARNESS_REGISTRY[id].binary]),
) as Record<HarnessId, string>;

export const PERMISSION_MODES = ["read-only"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionOutcome {
	mode: PermissionMode;
	fidelity: PermissionFidelity;
	mechanism: string;
}

export function resolvePermissionOutcome(
	harnessId: HarnessId,
	mode: PermissionMode = "read-only",
): PermissionOutcome {
	const registry = HARNESS_REGISTRY[harnessId];
	return {
		mode,
		fidelity: registry.readOnlyFidelity,
		mechanism: registry.readOnlyMechanism,
	};
}

/**
 * Why a run on `harnessId` must not start with `model` set, or null. A run
 * refuses what the row lacks rather than dropping it and running anyway
 * (ADR 0003 item 5, #639 rec 4).
 */
export function refuseModel(
	harnessId: HarnessId,
	model: string | undefined,
): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.modelVia !== "unsupported" || !model?.trim()) return null;
	return `${row.label} does not take a model setting; clear Model for it in Settings → Harness`;
}
