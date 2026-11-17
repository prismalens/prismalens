// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Readiness probe: `initialize` then `session/new`, no prompt turn, no model call,
 * never `authenticate`. A pass means "answers ACP", not "signed in": some agents
 * check credentials only at the first turn (#630, #916).
 */
import { Readable, Writable } from "node:stream";
import {
	type AuthMethod,
	client,
	type InitializeResponse,
	type McpServerStdio,
	methods,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	RequestError,
} from "@agentclientprotocol/sdk";
import { methods as unstable } from "@agentclientprotocol/sdk/unstable";
import { type AgentChild, killProcessTree, spawnAgent } from "./process.js";
import {
	ACCESS_LEVELS,
	type AccessLevel,
	AGENT_REGISTRY,
	type AgentId,
	type NamedMode,
} from "./registry/index.js";

export const PROBE_OUTCOMES = [
	"answers-acp",
	"sign-in-needed",
	"no-answer",
	"failed-to-start",
] as const;
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** ACP's auth_required error code. */
const AUTH_REQUIRED = -32000;
/** Spawn plus `initialize` (a cold first start passed 10 s), then `session/new` (Codex took 22 s on a slow network) (#1013). */
export const PROBE_BUDGETS_MS = {
	initialize: 30_000,
	session: 60_000,
} as const;
/** The `auth/status` fallback's budget; its silence never changes the outcome (#1171). */
export const AUTH_STATUS_BUDGET_MS = 6_000;
export type ProbeStep = "initialize" | "session/new";

const KEY = String.raw`[A-Z][A-Z0-9_]*_API_KEY\b`;
/** `KEY is not set`, or `set one of: KEY`: the key and the gap side by side, never just in one message. */
const UNSET_KEY = [
	new RegExp(
		String.raw`\b${KEY}\s+(?:is\s+|was\s+)?(?:not set|unset|missing|required|empty)\b`,
	),
	new RegExp(
		String.raw`(?:^|[\s(:,])(?:[Ss]et|[Mm]issing|[Nn]o|[Pp]rovide|[Rr]equires?)\s+(?:(?:one|any) of\s*:?\s*)?${KEY}`,
	),
];

/** A launch the agent refused: a bad flag or a usage line, whatever else it printed. */
const FATAL_LAUNCH =
	/unrecognized|unknown (?:flag|option|argument|command)|usage:|invalid option/i;

/**
 * An auth signal: ACP's auth_required in words, or a clause naming an unset provider key,
 * in text with no fatal launch error anywhere in `texts`; that error always means failed to start.
 */
export function namesSignIn(text: string, ...texts: string[]): boolean {
	if ([text, ...texts].some((t) => FATAL_LAUNCH.test(t))) return false;
	if (/auth_required|authentication required/i.test(text)) return true;
	return UNSET_KEY.some((re) => re.test(text));
}

export interface ProbeInput {
	agent: AgentId;
	command: string;
	args?: readonly string[];
	cwd: string;
	/** The child's whole env, built by the caller as for a launch (GitHub excluded). */
	env: Record<string, string>;
	mcpServers?: McpServerStdio[];
	/** `_meta` on `session/new`; the row's own by default. */
	sessionMeta?: Record<string, unknown>;
	/** Per-step budgets; `PROBE_BUDGETS_MS` by default. */
	budgets?: { initialize?: number; session?: number };
	/** How long to wait after `session/new` for a sign-in the agent pushes on `_auth/status_update`. */
	authStatusWaitMs?: number;
}

export interface ProbeAccount {
	label: string;
	email: string | null;
	organization: string | null;
	plan: string | null;
}

const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v : null;

/** `_auth/status_update`'s `{kind, label, account?}`, as both shipped adapters push it (#1171). */
function pushedAccount(status: Record<string, unknown>): ProbeAccount | null {
	const label = str(status.label);
	if (status.kind === "none" || !label) return null;
	const account = (status.account ?? {}) as Record<string, unknown>;
	return {
		label,
		email: str(account.email),
		organization: str(account.organization),
		plan: str(account.plan),
	};
}

/** ACP `auth/status`: the active account, else the first; one without a string label is none. */
function answeredAccount(res: unknown): {
	state: string | null;
	account: ProbeAccount | null;
} {
	const body = (res ?? {}) as { state?: unknown; accounts?: unknown };
	const state = str(body.state);
	const accounts = Array.isArray(body.accounts)
		? (body.accounts as Record<string, unknown>[]).filter(
				(a) => a && typeof a === "object",
			)
		: [];
	const pick = accounts.find((a) => a.active === true) ?? accounts[0];
	const label = pick ? str(pick.label) : null;
	return {
		state,
		account:
			pick && label && state === "authenticated"
				? {
						label,
						email: str(pick.email),
						organization: str(pick.organization),
						plan: null,
					}
				: null,
	};
}

export interface LevelCheck {
	mode: string | null;
	/** The level's mode, or its fallback, is in what the agent offered; true for an agent with no modes. */
	offered: boolean;
	/** Which mode the level would run: its own, its fallback, or none offered. */
	runs: string | null;
}

export interface ProbeResult {
	outcome: ProbeOutcome;
	agentInfo: { name: string; title?: string | null; version: string } | null;
	protocolVersion: number | null;
	authRequired: boolean;
	authMethods: { id: string; name: string }[];
	modes: { current: string | null; available: NamedMode[] } | null;
	models: { current: string | null; available: NamedMode[] } | null;
	levels: Record<AccessLevel, LevelCheck> | null;
	/** The error's message, or the agent's stderr tail when it died. One line. */
	detail: string | null;
	/** The kind the agent pushed on `_auth/status_update`; null when it pushed none in time. */
	authStatus: string | null;
	/** ACP `auth/status`'s state, or `authenticated`/`unauthenticated` from a push; null when neither came. */
	authState: string | null;
	/** The account it reported as signed in; null when it reported none. */
	account: ProbeAccount | null;
	/** The answers as sent, for what a product shows beyond this summary (efforts, images). */
	raw: {
		initialize: InitializeResponse | null;
		session: NewSessionResponse | null;
	};
}

function oneLine(text: string): string {
	return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

function selectOptions(
	res: NewSessionResponse,
	category: "mode" | "model",
): { current: string | null; available: NamedMode[] } | null {
	for (const opt of res.configOptions ?? []) {
		if (opt.category !== category || opt.type !== "select") continue;
		const flat = opt.options.flatMap((o) => ("options" in o ? o.options : [o]));
		return {
			current: opt.currentValue,
			available: flat.map((o) => ({ id: o.value, name: o.name })),
		};
	}
	return null;
}

/** ACP's order, as the engine reads it: the `mode` config option first, then the mode list. */
export function offeredModes(
	res: NewSessionResponse,
): { current: string | null; available: NamedMode[] } | null {
	const option = selectOptions(res, "mode");
	if (option) return option;
	if (res.modes?.availableModes.length)
		return {
			current: res.modes.currentModeId,
			available: res.modes.availableModes.map((m) => ({
				id: m.id,
				name: m.name,
			})),
		};
	return null;
}

/** Each level's mode against what the agent offered, so a renamed mode fails here and not mid-run. */
export function checkLevels(
	agent: AgentId,
	modes: readonly NamedMode[] | null,
): Record<AccessLevel, LevelCheck> {
	const row = AGENT_REGISTRY[agent];
	const has = (id: string | undefined) =>
		!!id && !!modes?.some((m) => m.id === id);
	return Object.fromEntries(
		ACCESS_LEVELS.map((level) => {
			const { mode, fallbackMode } = row.levels[level];
			if (!mode) return [level, { mode: null, offered: true, runs: null }];
			const runs = has(mode)
				? mode
				: has(fallbackMode)
					? (fallbackMode ?? null)
					: null;
			return [level, { mode, offered: runs !== null, runs }];
		}),
	) as Record<AccessLevel, LevelCheck>;
}

function signedOut(init: InitializeResponse): boolean {
	if (init._meta?.authenticated === false) return true;
	return (init.authMethods ?? []).some((m) => m._meta?.authenticated === false);
}

const methodsOf = (methods: AuthMethod[] | undefined) =>
	(methods ?? []).map((m) => ({ id: m.id, name: m.name }));

export async function probeAgent(input: ProbeInput): Promise<ProbeResult> {
	const budgets = { ...PROBE_BUDGETS_MS, ...input.budgets };
	const result: ProbeResult = {
		outcome: "failed-to-start",
		agentInfo: null,
		protocolVersion: null,
		authRequired: false,
		authMethods: [],
		modes: null,
		models: null,
		levels: null,
		detail: null,
		authStatus: null,
		authState: null,
		account: null,
		raw: { initialize: null, session: null },
	};
	let child: AgentChild;
	try {
		child = spawnAgent({
			command: input.command,
			args: [...(input.args ?? [])],
			cwd: input.cwd,
			env: input.env,
		});
	} catch (err) {
		return {
			...result,
			detail: oneLine(String((err as Error).message ?? err)),
		};
	}
	let stderr = "";
	// The tail keeps 2 KB; a fatal launch error is caught as it arrives, before help text pushes it out.
	let fatal: string | null = null;
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		const seen = stderr.slice(-128) + chunk;
		fatal ??= seen.split(/\r?\n/).find((l) => FATAL_LAUNCH.test(l)) ?? null;
		stderr = (stderr + chunk).slice(-2048);
	});
	const startFailed = (): string => {
		const tail = oneLine(stderr);
		const head = fatal ? oneLine(fatal) : "";
		return head && !tail.includes(head) ? `${head} … ${tail}` : tail;
	};
	child.stdin.on("error", () => {});

	let timer: NodeJS.Timeout | undefined;
	const died = new Promise<"died">((resolve) => {
		child.once("error", (err) => {
			stderr ||= err.message;
			resolve("died");
		});
		child.once("close", () => resolve("died"));
	});

	let pushed: (() => void) | null = null;
	const connection = client({ name: "prismalens-probe" })
		// No prompt turn is sent, so no ask can arrive; refuse any that does.
		.onRequest(methods.client.session.requestPermission, () => ({
			outcome: { outcome: "cancelled" },
		}))
		.onNotification(methods.client.session.update, () => {})
		.onNotification("*", ({ method, params }) => {
			const status = (
				params as { authStatus?: Record<string, unknown> } | undefined
			)?.authStatus;
			const kind = status?.kind;
			if (/^_?auth\/status_update$/.test(method) && typeof kind === "string") {
				result.authStatus = kind;
				result.authState =
					kind === "none" ? "unauthenticated" : "authenticated";
				result.account = status ? pushedAccount(status) : null;
				pushed?.();
			}
		})
		.connect(
			ndJsonStream(
				Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
				Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
			),
		);

	const exited = async (ms: number): Promise<void> => {
		let grace: NodeJS.Timeout | undefined;
		await Promise.race([
			died,
			new Promise<void>((resolve) => {
				grace = setTimeout(resolve, ms);
			}),
		]);
		clearTimeout(grace);
	};
	const race = async <T>(
		call: Promise<T>,
		ms: number,
	): Promise<T | "died" | "timeout"> => {
		call.catch(() => {});
		clearTimeout(timer);
		const deadline = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), ms);
		});
		return Promise.race([call, died, deadline]);
	};
	/** Never throws and never waits past its budget; the probe's outcome stands either way. */
	const askAuthStatus = async () => {
		let t: NodeJS.Timeout | undefined;
		const call = connection.agent
			.request<unknown>(unstable.agent.auth.status, {})
			.then(answeredAccount, () => null);
		const answer = await Promise.race([
			call,
			died.then(() => null),
			new Promise<null>((resolve) => {
				t = setTimeout(() => resolve(null), AUTH_STATUS_BUDGET_MS);
			}),
		]);
		clearTimeout(t);
		return answer;
	};
	const ended = (
		why: "died" | "timeout",
		step: ProbeStep,
		ms: number,
	): ProbeResult => {
		if (why === "timeout")
			return {
				...result,
				outcome: "no-answer",
				detail: `${step}: no answer in ${Math.max(1, Math.round(ms / 1000))}s`,
			};
		const detail = startFailed() || null;
		return detail && !fatal && namesSignIn(detail)
			? { ...result, outcome: "sign-in-needed", authRequired: true, detail }
			: { ...result, outcome: "failed-to-start", detail };
	};

	try {
		const init = await race(
			connection.agent.request(methods.agent.initialize, {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			}),
			budgets.initialize,
		);
		if (init === "died" || init === "timeout")
			return ended(init, "initialize", budgets.initialize);
		result.raw.initialize = init;
		result.agentInfo = init.agentInfo
			? {
					name: init.agentInfo.name,
					title: init.agentInfo.title ?? null,
					version: init.agentInfo.version,
				}
			: null;
		result.protocolVersion = init.protocolVersion;
		result.authMethods = methodsOf(init.authMethods);
		if (signedOut(init))
			return { ...result, outcome: "sign-in-needed", authRequired: true };

		const meta =
			input.sessionMeta ?? AGENT_REGISTRY[input.agent].sessionMeta?.();
		const session = await race(
			connection.agent.request(methods.agent.session.new, {
				cwd: input.cwd,
				mcpServers: input.mcpServers ?? [],
				...(meta ? { _meta: meta } : {}),
			}),
			budgets.session,
		);
		if (session === "died" || session === "timeout")
			return ended(session, "session/new", budgets.session);
		result.raw.session = session;
		const wait = input.authStatusWaitMs ?? 0;
		if (
			wait > 0 &&
			result.authStatus === null &&
			init.agentCapabilities?._meta?.authStatus !== undefined
		)
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, wait);
				pushed = () => {
					clearTimeout(timer);
					resolve();
				};
			});
		const auth = (
			init.agentCapabilities as { auth?: { status?: unknown } } | undefined
		)?.auth;
		if (result.authStatus === null && auth?.status != null) {
			const answer = await askAuthStatus();
			if (answer) {
				result.authState = answer.state;
				result.account = answer.account;
			}
		}
		const modes = offeredModes(session);
		return {
			...result,
			outcome: "answers-acp",
			modes,
			models: selectOptions(session, "model"),
			levels: checkLevels(input.agent, modes?.available ?? null),
		};
	} catch (err) {
		if (err instanceof RequestError && err.code === AUTH_REQUIRED)
			return {
				...result,
				outcome: "sign-in-needed",
				authRequired: true,
				detail: oneLine(err.message),
			};
		const message = err instanceof Error ? err.message : String(err);
		// A closed connection is the child exiting; its stderr may still be in flight.
		if (!(err instanceof RequestError)) await exited(1_000);
		const said = fatal
			? undefined
			: [message, stderr].find((t) => namesSignIn(t, message, stderr));
		if (said)
			return {
				...result,
				outcome: "sign-in-needed",
				authRequired: true,
				detail: oneLine(said),
			};
		return {
			...result,
			outcome: "failed-to-start",
			detail: startFailed() || oneLine(message),
		};
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null)
			killProcessTree(child, "SIGKILL");
		// Windows keeps a running child's cwd locked, so the caller can only remove it after this.
		await exited(5_000);
	}
}
