// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * CLI investigation input-resolution (ADR-0010/0011).
 *
 * The shared resolver — alert coercion, harness construction, `config → engine
 * inputs` — lives in `@prismalens/engine` (env-clean, reused by the web worker).
 * This module is the CLI's thin SHIM over it: it applies `pl.config.yaml` over the
 * shared `INVESTIGATION_DEFAULTS` fallbacks and reads BYO-key secrets from the
 * environment (ADR-0006), then calls the engine resolver. Keeping the
 * `resolveInvestigation(args, config)` signature means `investigate` and the
 * JSON-RPC `serve` path stay in lockstep, unchanged.
 */
import { resolve } from "node:path";
import type { PermissionMode } from "@prismalens/config/harness";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import { getDefaultModel } from "@prismalens/config/llm";
import type { ServiceContext } from "@prismalens/contracts";
import {
	coerceFiringAlert,
	resolveInvestigation as engineResolveInvestigation,
	type InvestigationRequest,
	type ResolvedInvestigation,
	type Sandbox,
	type SandboxLimits,
} from "@prismalens/engine";
import type { PlConfig } from "../config/schema.js";

export type { ResolvedInvestigation };

export interface ResolveInvestigationArgs {
	/** Raw alert payload (piped JSON / RPC param) coerced into a FiringAlert. */
	alert?: Record<string, unknown>;
	/** Multiple raw alerts (storm grouping). When present, supersedes `alert`. */
	alerts?: Record<string, unknown>[];
	/** Free-text fallback → a synthesized alert when no alert payload is supplied. */
	query?: string;
	/** Repository the harness investigates (its cwd). Defaults to `process.cwd()`. */
	repo?: string;
	/** Harness backend override; else `config.agent.default`. */
	harness?: string;
	/**
	 * Service name to select from `config.services` — overrides the alert's own
	 * service label. Covers `--query` runs that carry no labels (ADR-0015 §4).
	 */
	service?: string;
	/** The posture dial override (ADR-0017); else `config.agent.permissions.mode`. */
	permissionMode?: string;
	/**
	 * The resolved isolation boundary (ADR-0020), CALLER-OWNED — the command resolves
	 * it from `--sandbox`/`agent.sandbox` (`resolveSandbox`) and destroys it after the
	 * run. Forwarded to the engine so the harness spawns into it.
	 */
	sandbox?: Sandbox;
	/**
	 * What the CLI asked for (ADR-0020 honest fidelity, structured
	 * `fidelity.sandbox` field) — `selection.requested` from `resolveSandbox`,
	 * threaded alongside the resolved `sandbox` so a degrade (e.g. `auto` ->
	 * `process-floor`) is reported honestly in the run-metadata, not just the
	 * console warning.
	 */
	requestedSandbox?: string;
}

/**
 * Resolve a seed alert + merged `pl.config.yaml` into the inputs
 * `investigateIncidentStream` wants: applies the shared host-local fallbacks, reads
 * the BYO-key secrets from env, and delegates the actual build to the engine
 * resolver. Throws (via the engine) on a hard input error.
 */
export function resolveInvestigation(
	args: ResolveInvestigationArgs,
	config: PlConfig,
): ResolvedInvestigation {
	// cwd = --repo (a local repo path) else the current directory.
	const cwd = args.repo ? resolve(args.repo) : process.cwd();

	// BYO-key (ADR-0006): the engine never reads env — the CLI injects it here.
	const openaiBaseUrl =
		process.env.OLLAMA_BASE_URL ??
		process.env.OPENAI_BASE_URL ??
		INVESTIGATION_DEFAULTS.synth.baseURL;
	const apiKey = process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

	// Tier-1 reduce model: explicit agent.model wins; else the provider default
	// (ADR-0013). The CLI synth endpoint is OpenAI-compatible (ollama/openai base URL).
	const synthModel = config.agent.model ?? getDefaultModel("ollama");
	if (!synthModel) {
		throw new Error("No synthesis model configured (set agent.model).");
	}

	// Context enrichment (ADR-0015) — a single-alert CLI run is NOT context-free: it
	// still knows the service/repos/logs from `prismalens.config.yaml`.
	const service = selectService(args, config);
	const repos = config.repo
		? [config.repo]
		: Object.keys(config.repos).length > 0
			? Object.keys(config.repos)
			: undefined;
	const logs = config.logs.url
		? {
				...(config.logs.kind ? { kind: config.logs.kind } : {}),
				url: config.logs.url,
			}
		: undefined;

	// The single posture dial (ADR-0017): --mode / RPC `mode` wins; else
	// `agent.permissions.mode` (defaults to "read-only"). Native passthrough is
	// per-harness config, keyed by the resolved harness name.
	const harnessName = args.harness ?? config.agent.default;
	const permissionMode =
		(args.permissionMode as PermissionMode | undefined) ??
		config.agent.permissions.mode;
	const harnessNative = config.harnesses[harnessName]?.native;

	// Best-effort resource caps (ADR-0020): map the snake_case config knobs to the
	// engine's SandboxLimits shape, dropping unset ones so "no cap" stays no cap
	// (never a lying default). Only present when at least one knob is set.
	const limits = toSandboxLimits(config.agent.limits);

	const telemetry = {
		prometheusUrl:
			config.telemetry.prometheusUrl ??
			INVESTIGATION_DEFAULTS.telemetry.prometheusUrl,
		alertmanagerUrl:
			config.telemetry.alertmanagerUrl ??
			INVESTIGATION_DEFAULTS.telemetry.alertmanagerUrl,
		apiUrl: config.telemetry.apiUrl ?? INVESTIGATION_DEFAULTS.telemetry.apiUrl,
	};

	const request: InvestigationRequest = {
		query: args.query,
		harness: harnessName,
		permissionMode,
		...(harnessNative ? { harnessNative } : {}),
		...(args.sandbox ? { sandbox: args.sandbox } : {}),
		...(args.requestedSandbox
			? { requestedSandbox: args.requestedSandbox }
			: {}),
		...(limits ? { limits } : {}),
		// Per-alert fan-out cap (ADR-0016 decision 2): wire `agent.max_branches` when
		// set; unset leaves the engine default (mirrors the `limits` thread-through).
		...(config.agent.max_branches
			? { maxBranches: config.agent.max_branches }
			: {}),
		model: config.agent.model,
		cwd,
		synth: {
			providerId: "ollama",
			model: synthModel,
			apiKey,
			baseURL: openaiBaseUrl,
		},
		harnessEnv: {
			OPENAI_API_KEY: process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY,
			OPENAI_BASE_URL: openaiBaseUrl,
		},
		initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
	};

	if (args.alerts && args.alerts.length > 0) {
		request.context = {
			alerts: args.alerts.map(coerceFiringAlert),
			telemetry,
			...(service ? { service } : {}),
			...(repos ? { repos } : {}),
			...(logs ? { logs } : {}),
		};
	} else {
		request.alert = args.alert;
		request.telemetry = telemetry;
		if (service) request.service = service;
		if (repos) request.repos = repos;
		if (logs) request.logs = logs;
	}

	return engineResolveInvestigation(request);
}

/**
 * Map the parsed `agent.limits` (snake_case, all optional) into the engine's
 * {@link SandboxLimits} (camelCase), dropping unset knobs. Returns `undefined` when
 * nothing is set so the request stays limit-free — an omitted cap is never coerced to
 * a lying value (ADR-0020).
 */
function toSandboxLimits(
	limits: PlConfig["agent"]["limits"],
): SandboxLimits | undefined {
	const out: SandboxLimits = {
		...(limits.wall_clock_ms ? { wallClockMs: limits.wall_clock_ms } : {}),
		...(limits.memory_mb ? { memoryMb: limits.memory_mb } : {}),
		...(limits.cpu_cores ? { cpuCores: limits.cpu_cores } : {}),
	};
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Label-driven service selection (ADR-0015 §4): `--service` wins; else the alert's
 * own service label; no match in the catalog → no service context (degrade to
 * telemetry + cwd, today's behaviour — never an error).
 */
function selectService(
	args: ResolveInvestigationArgs,
	config: PlConfig,
): ServiceContext | undefined {
	const name = args.service ?? pickServiceLabel(args.alerts?.[0] ?? args.alert);
	if (!name) return undefined;
	const cfg = config.services[name];
	if (!cfg) return undefined;
	return {
		name,
		...(cfg.tier ? { tier: cfg.tier } : {}),
		...(cfg.repo ? { repo: cfg.repo } : {}),
		...(cfg.depends_on.length > 0 ? { dependsOn: cfg.depends_on } : {}),
	};
}

/**
 * The alert's service identity label — `service`, else `namespace`, else `job`.
 * Exported for the `listen` path's per-payload repo resolution (issue #58 AC5).
 */
export function pickServiceLabel(
	alert: Record<string, unknown> | undefined,
): string | undefined {
	const labels = (alert?.labels ?? {}) as Record<string, unknown>;
	const pick = labels.service ?? labels.namespace ?? labels.job;
	return typeof pick === "string" && pick ? pick : undefined;
}
