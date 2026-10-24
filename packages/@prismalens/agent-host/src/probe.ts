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
	ClientSideConnection,
	type InitializeResponse,
	type McpServerStdio,
	type NewSessionResponse,
	ndJsonStream,
	PROTOCOL_VERSION,
	RequestError,
} from "@agentclientprotocol/sdk";
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
const DEFAULT_TIMEOUT_MS = 10_000;

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
	timeoutMs?: number;
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

function offeredModes(
	res: NewSessionResponse,
): { current: string | null; available: NamedMode[] } | null {
	if (res.modes?.availableModes.length)
		return {
			current: res.modes.currentModeId,
			available: res.modes.availableModes.map((m) => ({
				id: m.id,
				name: m.name,
			})),
		};
	return selectOptions(res, "mode");
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
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-2048);
	});
	child.stdin.on("error", () => {});

	let timer: NodeJS.Timeout | undefined;
	const died = new Promise<"died">((resolve) => {
		child.once("error", (err) => {
			stderr ||= err.message;
			resolve("died");
		});
		child.once("exit", () => resolve("died"));
	});
	const deadline = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});

	const connection = new ClientSideConnection(
		() => ({
			// No prompt turn is sent, so no ask can arrive; refuse any that does.
			requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			sessionUpdate: async () => {},
		}),
		ndJsonStream(
			Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
		),
	);

	const race = async <T>(call: Promise<T>): Promise<T | "died" | "timeout"> => {
		call.catch(() => {});
		return Promise.race([call, died, deadline]);
	};
	const ended = (why: "died" | "timeout"): ProbeResult =>
		why === "timeout"
			? {
					...result,
					outcome: "no-answer",
					detail: `no answer in ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
				}
			: {
					...result,
					outcome: "failed-to-start",
					detail: oneLine(stderr) || null,
				};

	try {
		const init = await race(
			connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			}),
		);
		if (init === "died" || init === "timeout") return ended(init);
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
			connection.newSession({
				cwd: input.cwd,
				mcpServers: input.mcpServers ?? [],
				...(meta ? { _meta: meta } : {}),
			}),
		);
		if (session === "died" || session === "timeout") return ended(session);
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
		if (/auth_required|authentication required/i.test(message))
			return {
				...result,
				outcome: "sign-in-needed",
				authRequired: true,
				detail: oneLine(message),
			};
		return {
			...result,
			outcome: "failed-to-start",
			detail: oneLine(stderr || message),
		};
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null)
			killProcessTree(child, "SIGKILL");
	}
}
