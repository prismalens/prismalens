// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness handshake probe (#630, Unit D on #337). `pl doctor` and the Settings
 * check both call this, and both print `detail` verbatim, so they use the same
 * words. `initialize` + `session/new` only: no prompt turn, no model call.
 *
 * It never says "ready". A logged-out agent can pass the handshake: opencode
 * needs no provider for `session/new`, and claude-agent-acp checks credentials
 * only at turn start. So a pass means "answers ACP", nothing more.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_DEFAULT_MODE,
	getHarnessProviderKeys,
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	runnableModes,
} from "@prismalens/config/harness";
import {
	type AcpOfferedEffort,
	type AcpOfferedMode,
	type AcpOfferedModel,
	AcpRpcError,
	AcpSession,
} from "../runner/acp-client.js";
import { prepareRunEnv } from "./investigate.js";
import { denyAllPolicy } from "./permission.js";
import { checkSandbox, type SandboxChecks } from "./sandbox-check.js";

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
/** ACP's auth_required error code. */
const AUTH_REQUIRED = -32000;

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

export function classify(
	err: unknown,
	session: AcpSession,
	timeoutMs: number,
): Pick<HarnessProbeResult, "outcome" | "detail"> {
	const message = oneLine(
		err instanceof AcpRpcError && err.data
			? `${err.message} ${err.data}`
			: err instanceof Error
				? err.message
				: String(err),
	);
	const isCodexAuth = /CODEX_API_KEY or OPENAI_API_KEY is not set/i.test(
		message,
	);
	if (
		(err instanceof AcpRpcError && err.code === AUTH_REQUIRED) ||
		/auth_required|authentication required/i.test(message) ||
		isCodexAuth
	) {
		const methods = session.authMethods
			.map((m) => m.name ?? m.id)
			.filter(Boolean);
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
	if (/timed out after/.test(message)) {
		return {
			outcome: "no-answer",
			detail: `no answer in ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
		};
	}
	// A spawn error, or a harness that exited before it answered the handshake.
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
		>;
		timeoutMs?: number;
		sandbox?: typeof checkSandbox;
	} = {},
): Promise<HarnessProbeResult> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[harness];
	const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const runDir = mkdtempSync(join(tmpdir(), "pl-doctor-"));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });

	try {
		const { env, runEnv } = prepareRunEnv({
			harness,
			descriptor,
			cwd,
			runDir,
			env: getHarnessProviderKeys(harness, process.env),
		});
		const session = new AcpSession({
			command: descriptor.binary,
			args: descriptor.acpArgs(runEnv),
			cwd,
			env,
			// open() sends no prompt turn, so no ask can arrive; nobody could answer one.
			permission: denyAllPolicy,
			sessionMeta: descriptor.sessionMeta?.(),
			initTimeoutMs: timeoutMs,
		});
		// open() times initialize and session/new separately; the probe promises one deadline for both.
		let timer: NodeJS.Timeout | undefined;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`handshake timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});
		const opening = session.open();
		opening.catch(() => {});
		let answered: HarnessProbeResult;
		try {
			await Promise.race([opening, deadline]);
			const agent = session.agent;
			const detail = `answers ACP${agent.version ? `, ${agent.name ?? harness} ${agent.version}` : ""}`;
			answered = {
				id: harness,
				outcome: "answers-acp",
				detail,
				hard: false,
				...(session.models.length ? { models: session.models } : {}),
				servedModel: session.servedModel,
				effort: session.effort,
				modes: runnableModes(harness, session.offeredModes),
				efforts: effortLevels(session.effort),
				images: session.takesImages,
			};
		} catch (err) {
			return { id: harness, ...classify(err, session, timeoutMs), hard: false };
		} finally {
			clearTimeout(timer);
			await session.close();
		}
		const modeIds = answered.modes?.map((m) => m.id) ?? [AGENT_DEFAULT_MODE];
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
