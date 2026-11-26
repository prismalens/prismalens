// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Plan limits before any run (#1180): Codex through `codex app-server`, Claude Code through
 * the Agent SDK driving the user's own `claude`. No prompt, no model call; PrismaLens reads
 * no credential, the CLI reads its own. Hooks and the MCP servers found are off for the read.
 */
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
	AccountInfo,
	Options,
	Query,
} from "@anthropic-ai/claude-agent-sdk";
import {
	killProcessTree,
	type LaunchPolicy,
	spawnAgent,
} from "@prismalens/agent-host";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { LimitWindow } from "@prismalens/contracts";
import { parse as parseToml } from "smol-toml";
import { removeRunDir } from "./harness-doctor.js";
import { prepareRunEnv } from "./investigate.js";

export interface LimitReadWindow {
	/** `<limitId or type>:<position or window>`, the key a run's window of the same kind carries. */
	key: string;
	window: LimitWindow | null;
	type: string | null;
	usedPercent: number | null;
	resetsAt: string | null;
	status: string | null;
}

export interface LimitRead {
	/** The account the same process read: its email, else its label; null when it named none. */
	account: string | null;
	at: string;
	windows: LimitReadWindow[];
}

export interface LimitReadPlan {
	/** The agent's own CLI, as the run would start it. */
	command: string;
	/** Arguments before the CLI's own, for a CLI started through another program. */
	args?: readonly string[];
	/** The planned env of a run on this agent. */
	env: Record<string, string>;
	cwd: string;
}

type ClaudeQuery = (params: {
	prompt: AsyncIterable<never>;
	options: Options;
}) => Pick<Query, "accountInfo" | "close"> &
	Partial<
		Pick<Query, "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET">
	>;

export interface LimitReadDeps {
	budgetMs?: number;
	now?: () => Date;
	/** The SDK's `query`; tests pass a fake. */
	query?: ClaudeQuery;
	/** The OS user profile, where `~` config lives. */
	home?: string;
	/** Claude Code's managed settings file on this platform. */
	managedSettingsPath?: string;
}

export const LIMIT_READ_BUDGET_MS = 15_000;
const CLIENT_VERSION = "1";

/** One read; null when the agent has no such read, the CLI failed, or the budget ran out. */
export async function readLimits(
	agent: HarnessId,
	plan: LimitReadPlan,
	deps: LimitReadDeps = {},
): Promise<LimitRead | null> {
	const via = HARNESS_REGISTRY[agent]?.limitsBeforeRun;
	const budget = deps.budgetMs ?? LIMIT_READ_BUDGET_MS;
	if (via === "codex-app-server") return readCodex(plan, budget, deps);
	if (via === "claude-sdk") return readClaude(plan, budget, deps);
	return null;
}

/**
 * A read on the run env a check of `agent` plans, in a scratch folder: the agent's own CLI
 * from Settings or PATH, never a copy PrismaLens ships. Null when that CLI is not found.
 */
export async function readAgentLimits(
	agent: HarnessId,
	runtime: {
		env?: Record<string, string>;
		policy?: LaunchPolicy;
		binaryPath?: string;
	} = {},
	deps: LimitReadDeps = {},
): Promise<LimitRead | null> {
	if (!HARNESS_REGISTRY[agent]?.limitsBeforeRun) return null;
	const runDir = mkdtempSync(join(tmpdir(), `pl-limits-${Date.now()}-`));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });
	try {
		const { env, runEnv } = prepareRunEnv({
			harness: agent,
			cwd,
			runDir,
			env: runtime.env ?? {},
			...(runtime.policy ? { policy: runtime.policy } : {}),
			...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
		});
		if (!runEnv.companionPath) return null;
		return await readLimits(
			agent,
			{ command: runEnv.companionPath, env, cwd },
			deps,
		);
	} finally {
		removeRunDir(runDir);
	}
}

// ---------------------------------------------------------------- Codex

type Rpc = { id?: number; result?: unknown; error?: unknown };

/** The `-c` overrides that keep the user's hooks and MCP servers from starting (R1). */
export function codexAppServerArgs(mcp: readonly string[]): string[] {
	const name = (n: string) =>
		/^[A-Za-z0-9_-]+$/.test(n) ? n : JSON.stringify(n);
	return [
		"app-server",
		"-c",
		"features.hooks=false",
		...mcp.flatMap((n) => ["-c", `mcp_servers.${name(n)}.enabled=false`]),
	];
}

/** The MCP server names in the user's own `config.toml`, under the planned `CODEX_HOME`. */
export function codexUserMcpNames(
	env: Record<string, string>,
	home: string = homedir(),
): string[] {
	const dir = env.CODEX_HOME || join(home, ".codex");
	try {
		const config = parseToml(readFileSync(join(dir, "config.toml"), "utf8"));
		const servers = config.mcp_servers;
		return servers && typeof servers === "object" && !Array.isArray(servers)
			? Object.keys(servers)
			: [];
	} catch {
		return [];
	}
}

async function readCodex(
	plan: LimitReadPlan,
	budget: number,
	deps: LimitReadDeps,
): Promise<LimitRead | null> {
	const child = spawnAgent({
		command: plan.command,
		args: [
			...(plan.args ?? []),
			...codexAppServerArgs(codexUserMcpNames(plan.env, deps.home)),
		],
		cwd: plan.cwd,
		env: plan.env,
	});
	const pending = new Map<number, (msg: Rpc) => void>();
	let next = 0;
	child.stdin.on("error", () => {});
	createInterface({ input: child.stdout }).on("line", (line) => {
		try {
			const msg = JSON.parse(line) as Rpc;
			if (typeof msg.id === "number") pending.get(msg.id)?.(msg);
		} catch {
			// A log line on stdout is not an answer.
		}
	});
	child.stderr.resume();
	const exited = new Promise<null>((resolve) => {
		child.once("error", () => resolve(null));
		child.once("exit", () => resolve(null));
	});
	const call = (method: string, params: unknown) =>
		new Promise<unknown>((resolve, reject) => {
			const id = ++next;
			pending.set(id, (msg) => {
				pending.delete(id);
				if (msg.error !== undefined)
					reject(new Error(JSON.stringify(msg.error)));
				else resolve(msg.result);
			});
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	const read = async (): Promise<LimitRead | null> => {
		await call("initialize", {
			clientInfo: { name: "prismalens", version: CLIENT_VERSION },
		});
		child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
		const account = await call("account/read", {});
		const limits = await call("account/rateLimits/read", null);
		const windows = codexWindows(limits);
		if (!windows.length) return null;
		return {
			account: codexAccount(account),
			at: (deps.now?.() ?? new Date()).toISOString(),
			windows,
		};
	};
	try {
		return await withBudget(
			Promise.race([read(), exited]).catch(() => null),
			budget,
		);
	} finally {
		killProcessTree(child);
	}
}

function codexAccount(res: unknown): string | null {
	const a = (res as { account?: Record<string, unknown> | null } | null)
		?.account;
	if (!a) return null;
	return str(a.email) ?? str(a.workspaceName) ?? str(a.type);
}

type CodexWindow = {
	usedPercent?: unknown;
	resetsAt?: unknown;
	windowDurationMins?: unknown;
};
type CodexSnapshot = {
	limitId?: string | null;
	planType?: string | null;
	primary?: CodexWindow | null;
	secondary?: CodexWindow | null;
	individualLimit?: { remainingPercent?: unknown; resetsAt?: unknown } | null;
};

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

const kindFor = (mins: number): LimitWindow =>
	mins >= MONTH_MINS ? "monthly" : mins >= WEEK_MINS ? "weekly" : "session";

/**
 * Every bucket `account/rateLimits/read` returned, mapped as t3code's `codexUsageLimits.ts`:
 * primary and secondary are positions; with no duration, paid plans read 5 hours and a
 * week and Free and Go a month. Any other bucket is a model window named by its id.
 */
export function codexWindows(res: unknown): LimitReadWindow[] {
	const body = (res ?? {}) as {
		rateLimits?: CodexSnapshot | null;
		rateLimitsByLimitId?: Record<string, CodexSnapshot> | null;
	};
	// `rateLimits` is the main allowance's bucket, the single view older CLIs send alone.
	const mainId = body.rateLimits?.limitId ?? "main";
	const buckets: [string, CodexSnapshot][] = body.rateLimitsByLimitId
		? Object.entries(body.rateLimitsByLimitId)
		: body.rateLimits
			? [[mainId, body.rateLimits]]
			: [];
	const out: LimitReadWindow[] = [];
	for (const [id, snap] of buckets) {
		const main = id === mainId;
		const monthly = snap.planType === "free" || snap.planType === "go";
		const positions = [
			["primary", snap.primary, monthly ? MONTH_MINS : SESSION_MINS],
			["secondary", snap.secondary, WEEK_MINS],
		] as const;
		for (const [position, w, fallback] of positions) {
			if (!w || typeof w.usedPercent !== "number") continue;
			const mins =
				typeof w.windowDurationMins === "number"
					? w.windowDurationMins
					: fallback;
			out.push({
				key: `${id}:${position}`,
				window: main ? kindFor(mins) : "model",
				type: main ? null : id,
				usedPercent: clamp(w.usedPercent),
				resetsAt: isoFromSeconds(w.resetsAt),
				status: null,
			});
		}
		const individual = snap.individualLimit;
		if (main && individual && typeof individual.remainingPercent === "number")
			out.push({
				key: `${id}:individual`,
				window: null,
				type: "monthly_credit_limit",
				usedPercent: clamp(100 - individual.remainingPercent),
				resetsAt: isoFromSeconds(individual.resetsAt),
				status: null,
			});
	}
	return out;
}

// ---------------------------------------------------------------- Claude Code

/** Claude Code's managed settings file, per its settings docs and the SDK bundle. */
export function claudeManagedSettingsPath(
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "win32")
		return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
	if (platform === "darwin")
		return "/Library/Application Support/ClaudeCode/managed-settings.json";
	return "/etc/claude-code/managed-settings.json";
}

/**
 * An `apiKeyHelper` in the settings the child would read: an API-key session has no plan
 * limits, so no read starts. An optimisation only; R1 says a helper may run in a check.
 */
export function claudeUsesApiKeyHelper(
	env: Record<string, string>,
	home: string,
	managed: string,
): boolean {
	const user = join(
		env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
		"settings.json",
	);
	return [user, managed].some((path) => {
		try {
			const s = JSON.parse(readFileSync(path, "utf8")) as {
				apiKeyHelper?: unknown;
			};
			return typeof s.apiKeyHelper === "string" && s.apiKeyHelper.trim() !== "";
		} catch {
			return false;
		}
	});
}

async function readClaude(
	plan: LimitReadPlan,
	budget: number,
	deps: LimitReadDeps,
): Promise<LimitRead | null> {
	if (
		claudeUsesApiKeyHelper(
			plan.env,
			deps.home ?? homedir(),
			deps.managedSettingsPath ?? claudeManagedSettingsPath(),
		)
	)
		return null;
	const query =
		deps.query ??
		((await import("@anthropic-ai/claude-agent-sdk")).query as ClaudeQuery);
	let release = () => {};
	const opened = new Promise<void>((resolve) => {
		release = resolve;
	});
	// Streaming-input mode with no message: the session stays open until the read ends.
	const prompt: AsyncIterable<never> = {
		[Symbol.asyncIterator]: () => ({
			next: async () => {
				await opened;
				return { done: true, value: undefined };
			},
		}),
	};
	let q: ReturnType<ClaudeQuery> | null = null;
	const read = async (): Promise<LimitRead | null> => {
		q = query({
			prompt,
			options: {
				pathToClaudeCodeExecutable: plan.command,
				cwd: plan.cwd,
				env: { ...plan.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
				settingSources: ["user"],
				strictMcpConfig: true,
				mcpServers: {},
				settings: { disableAllHooks: true },
			},
		});
		const usage = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof usage !== "function") return null;
		const info = await q.accountInfo();
		const res = await usage.call(q, { skipBehaviors: true });
		const windows = claudeWindows(res?.rate_limits ?? null);
		if (!res?.rate_limits_available || !windows.length) return null;
		return {
			account: claudeAccount(info),
			at: (deps.now?.() ?? new Date()).toISOString(),
			windows,
		};
	};
	try {
		return await withBudget(
			read().catch(() => null),
			budget,
		);
	} finally {
		release();
		try {
			(q as ReturnType<ClaudeQuery> | null)?.close();
		} catch {
			// Closed already.
		}
	}
}

function claudeAccount(info: AccountInfo): string | null {
	return (
		str(info.email) ??
		str(info.organization) ??
		str(info.subscriptionType) ??
		str(info.apiProvider)
	);
}

type ClaudeBucket = { utilization?: number | null; resets_at?: string | null };

const CLAUDE_WINDOWS: readonly [string, LimitWindow][] = [
	["five_hour", "session"],
	["seven_day", "weekly"],
	["seven_day_opus", "model"],
	["seven_day_sonnet", "model"],
];

/**
 * `rate_limits` from the SDK's usage call, mapped as t3code's `claudeUsageLimits.ts`
 * (percentages already 0-100), keyed like the windows a run reports (`quotaOf`).
 */
export function claudeWindows(limits: unknown): LimitReadWindow[] {
	if (!limits || typeof limits !== "object") return [];
	const r = limits as Record<string, unknown>;
	const out: LimitReadWindow[] = [];
	const push = (type: string, window: LimitWindow, b: ClaudeBucket) => {
		if (typeof b.utilization !== "number") return;
		out.push({
			key: `${type}:${window}`,
			window,
			type,
			usedPercent: clamp(b.utilization),
			resetsAt: isoFromString(b.resets_at),
			status: null,
		});
	};
	for (const [type, window] of CLAUDE_WINDOWS) {
		const b = r[type] as ClaudeBucket | null | undefined;
		if (b) push(type, window, b);
	}
	if (Array.isArray(r.model_scoped))
		for (const m of r.model_scoped as (ClaudeBucket & {
			display_name?: unknown;
		})[]) {
			const name = str(m?.display_name);
			if (name)
				push(
					`seven_day_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
					"model",
					m,
				);
		}
	const extra = r.extra_usage as
		| {
				is_enabled?: boolean;
				monthly_limit?: number | null;
				used_credits?: number | null;
				utilization?: number | null;
		  }
		| null
		| undefined;
	if (extra?.is_enabled) {
		const share =
			typeof extra.used_credits === "number" &&
			typeof extra.monthly_limit === "number" &&
			extra.monthly_limit > 0
				? (extra.used_credits / extra.monthly_limit) * 100
				: extra.utilization;
		push("monthly_spend", "monthly", { utilization: share ?? null });
	}
	return out;
}

// ---------------------------------------------------------------- shared

const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v : null;

const clamp = (n: number) =>
	Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

function isoFromSeconds(v: unknown): string | null {
	return typeof v === "number" && Number.isFinite(v) && v > 0
		? new Date(v * 1000).toISOString()
		: null;
}

function isoFromString(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function withBudget<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), ms);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
