// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The readiness check (#630, Unit D on #337): agent-host's `probeAgent` (#916) with the
 * run's own launch plan, and the words Settings shows. `initialize` + `session/new` only:
 * no prompt turn, no model call. A pass means "answers ACP", never "ready": opencode needs
 * no provider for `session/new`, and claude-agent-acp checks credentials at turn start.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LaunchPolicy,
	type ProbeResult,
	probeAgent,
	versionOf,
} from "@prismalens/agent-host";
import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	NO_MODE_KEY,
} from "@prismalens/config/harness";
import {
	type AcpOfferedEffort,
	type AcpOfferedMode,
	type AcpOfferedModel,
	offeredEffort,
	offeredModels,
	offeredModes,
	selectedModel,
} from "../runner/acp-client.js";
import { prepareRunEnv } from "./investigate.js";
import { checkSandbox, type SandboxChecks } from "./sandbox-check.js";

export { versionOf };

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
/** claude-agent-acp pushes its sign-in after `initialize` from a CLI probe it never waits on. */
const AUTH_STATUS_WAIT_MS = 3_000;

export type HarnessProbeOutcome =
	| "answers-acp"
	| "sign-in-needed"
	| "no-answer"
	| "failed-to-start";

export interface HarnessProbeResult {
	id: HarnessId;
	outcome: HarnessProbeOutcome;
	/** The outcome's fixed words, plus the auth method names or the harness's stderr tail when there are any. One line. */
	detail: string;
	hard: false;
	/** The version the agent reported in `initialize`; null when it reported none. */
	version?: string | null;
	/** `<companion> --version` for a row whose adapter drives a separate CLI (#818). */
	companionVersion?: string | null;
	/** The models the harness itself offered on `session/new`; absent when it did not answer. */
	models?: AcpOfferedModel[];
	/** What it reported as its current model, its effort option and whether it takes images (R4.2, R4.3). */
	servedModel?: string | null;
	effort?: AcpOfferedEffort | null;
	/** The agent's own permission modes and effort levels, by its names (#673 w21); null when it offered none. */
	modes?: AcpOfferedMode[] | null;
	efforts?: { id: string; name: string; default: boolean }[] | null;
	images?: boolean;
	/** Per offered mode (or `agent-default`): does the agent's own sandbox hold it on this machine (#673 w51). */
	sandbox?: SandboxChecks;
	/** The agent pushed its sign-in: true when it says signed out; absent when it pushed none (#831). */
	signedOut?: boolean;
}

function effortLevels(
	effort: AcpOfferedEffort | null,
): HarnessProbeResult["efforts"] {
	if (!effort) return null;
	return effort.levels.map((l) => ({ ...l, default: l.id === effort.default }));
}

function oneLine(message: string): string {
	return message.replace(/\s*\r?\n\s*/g, " ").trim();
}

/** The check's line for an agent that answered, naming the adapter PrismaLens ships when it ran through it (#831 w6-3). */
export function answeredDetail(
	harness: string,
	agent: { name?: string | null; version?: string | null },
	shipped: boolean,
): string {
	const via = shipped ? " through the adapter PrismaLens ships" : "";
	const who = agent.version
		? `, ${agent.name ?? harness} ${agent.version}`
		: "";
	return `answers ACP${via}${who}`;
}

/** A probe that did not answer, in the check's words: sign-in, no answer, or failed to start. */
export function classify(
	probed: Pick<ProbeResult, "outcome" | "detail" | "authMethods">,
): Pick<HarnessProbeResult, "outcome" | "detail"> {
	const message = oneLine(probed.detail ?? "");
	const isCodexAuth = /CODEX_API_KEY or OPENAI_API_KEY is not set/i.test(
		message,
	);
	if (probed.outcome === "sign-in-needed" || isCodexAuth) {
		const methods = probed.authMethods.map((m) => m.name || m.id);
		const authList =
			methods.length > 0
				? methods.join(", ")
				: isCodexAuth
					? "API Key, ChatGPT"
					: null;
		return {
			outcome: "sign-in-needed",
			detail: authList ? `sign in needed (${authList})` : "sign in needed",
		};
	}
	if (probed.outcome === "no-answer")
		return { outcome: "no-answer", detail: message || "no answer" };
	const tail = message.replace(/^failed to start [^:]*:\s*/, "");
	return {
		outcome: "failed-to-start",
		detail: tail ? `failed to start: ${tail}` : "failed to start",
	};
}

/**
 * `initialize` -> `session/new`, no prompt turn, closed immediately. Callers
 * loop harness ids and `await` each in turn — never `Promise.all` — so two
 * probes never race for the same process group or confuse a hang in one
 * harness for a hang in another.
 */
export async function probeHarness(
	harness: HarnessId,
	opts: {
		descriptor?: Pick<
			HarnessDescriptor,
			| "binary"
			| "acpArgs"
			| "acpEnv"
			| "configFiles"
			| "sessionMeta"
			| "companionBinary"
			| "adapterPackage"
		>;
		timeoutMs?: number;
		sandbox?: typeof checkSandbox;
		authWaitMs?: number;
		/** The agent's stored values from Settings (#907). */
		env?: Record<string, string>;
		/** The floor a run on this agent would get (#817). */
		policy?: LaunchPolicy;
		binaryPath?: string;
		launchArgs?: string[];
	} = {},
): Promise<HarnessProbeResult> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[harness];
	const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const runDir = mkdtempSync(join(tmpdir(), "pl-doctor-"));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });

	try {
		const { env, args, runEnv, launch } = prepareRunEnv({
			harness,
			...(opts.descriptor ? { descriptor: opts.descriptor } : {}),
			cwd,
			runDir,
			env: opts.env ?? {},
			...(opts.policy ? { policy: opts.policy } : {}),
			...(opts.binaryPath ? { binaryPath: opts.binaryPath } : {}),
			...(opts.launchArgs ? { launchArgs: opts.launchArgs } : {}),
		});
		// Only a CLI the adapter is pointed at; a PATH codex-acp runs its own codex.
		// Read on every outcome, so a signed-out row still names its version (w8-8).
		const companion = () =>
			runEnv.companionPath &&
			Object.values(descriptor.acpEnv(runEnv)).includes(runEnv.companionPath)
				? versionOf(runEnv.companionPath)
				: Promise.resolve(null);
		const meta = descriptor.sessionMeta?.();
		const probed = await probeAgent({
			agent: harness,
			command: launch.command,
			args,
			cwd,
			env,
			...(meta ? { sessionMeta: meta } : {}),
			timeoutMs,
			authStatusWaitMs: opts.authWaitMs ?? AUTH_STATUS_WAIT_MS,
		});
		if (probed.outcome !== "answers-acp" || !probed.raw.session) {
			const companionVersion = await companion();
			return {
				id: harness,
				...classify(probed),
				hard: false,
				...(companionVersion ? { companionVersion } : {}),
			};
		}
		const options = probed.raw.session.configOptions;
		const models = offeredModels(options);
		const effort = offeredEffort(options);
		const modes = offeredModes(probed.raw.session).modes;
		const agent = {
			name: probed.agentInfo?.name ?? null,
			version: probed.agentInfo?.version ?? null,
		};
		const answered: HarnessProbeResult = {
			id: harness,
			outcome: "answers-acp",
			detail: answeredDetail(harness, agent, launch.shipped),
			hard: false,
			version: agent.version,
			companionVersion: await companion(),
			...(models.length ? { models } : {}),
			servedModel: selectedModel(options),
			effort,
			modes: modes.length ? modes : null,
			efforts: effortLevels(effort),
			images:
				probed.raw.initialize?.agentCapabilities?.promptCapabilities?.image ===
				true,
			...(probed.authStatus !== null
				? { signedOut: probed.authStatus === "none" }
				: {}),
		};
		const modeIds = answered.modes?.map((m) => m.id) ?? [NO_MODE_KEY];
		// A failed sandbox check must not lose an agent that answered ACP.
		const sandbox = await (opts.sandbox ?? checkSandbox)(harness, modeIds, {
			env,
		}).catch((err: unknown): SandboxChecks => {
			const reason = `Sandbox check failed: ${err instanceof Error ? err.message : String(err)}`;
			return Object.fromEntries(
				modeIds.map((id) => [id, { state: "unknown", reason }]),
			);
		});
		return { ...answered, sandbox };
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
}
