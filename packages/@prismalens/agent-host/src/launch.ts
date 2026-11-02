// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The launch plan: command, env and files for one agent run. Env layers, last wins:
 * the floor, the row's provider keys from the host, the user's stored values, the
 * row's own env, then the caller's overrides; refusals run over the result (#916).
 */
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, win32 } from "node:path";
import { AgentHostError } from "./errors.js";
import {
	type AccessLevel,
	AGENT_REGISTRY,
	type AgentDescriptor,
	type AgentId,
	type AgentRunEnv,
	isJsonObject,
	isSafeGatewayUrl,
	type JsonObject,
	mergeConfigPatch,
	type ResolvedLevel,
	resolveLevel,
	type UserSetup,
} from "./registry/index.js";

/**
 * The `.exe` an npm `.cmd` shim runs, else `path`. The companion is handed to an adapter that
 * spawns it without a shell, and Node refuses a `.cmd` that way (CVE-2024-27980, #1013).
 */
export function shimTarget(
	path: string,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform !== "win32" || !/\.(cmd|bat)$/i.test(path)) return path;
	let shim: string;
	try {
		shim = readFileSync(path, "utf8");
	} catch {
		return path;
	}
	const exe = [...shim.matchAll(/"%dp0%\\([^"]+\.exe)"/gi)]
		.map((m) => m[1] as string)
		.filter((rel) => !/^node\.exe$/i.test(rel))
		.at(-1);
	const target = exe && win32.join(win32.dirname(path), exe);
	return target && existsSync(target) ? target : path;
}

/**
 * Own-secret isolation (ADR-0009): the child gets a bare-minimum shell env, never
 * the host's verbatim. Copied from the engine's `SAFE_ENV_ALLOWLIST`.
 */
export const SAFE_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"TZ",
	"PWD",
	// Behind a corporate proxy or private CA the agent cannot reach its provider without these (#633).
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"REQUESTS_CA_BUNDLE",
	// A relocated data home is where OpenCode keeps a `/connect` login.
	"XDG_DATA_HOME",
	"XDG_CONFIG_HOME",
	"CLAUDE_CONFIG_DIR",
	"CODEX_HOME",
	"GEMINI_CLI_HOME",
] as const;

export const GITHUB_TOKEN_VARS = [
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GH_ENTERPRISE_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN",
] as const;

/** Which host variables reach the child before the row's keys. Products default to the denylist (#817); `allowlist` is the strict mode. */
export type EnvFloor =
	| { mode: "allowlist"; extraAllow?: readonly string[] }
	| {
			mode: "inherit-minus-own-secrets";
			/** The product's own secrets, by name and prefix; dropped from every layer, after overrides. */
			ownSecrets: { names?: readonly string[]; prefixes?: readonly string[] };
	  };

export interface LaunchPolicy {
	userSetup: UserSetup;
	/** `exclude` drops the GitHub token vars, empties GH_CONFIG_DIR and blanks git's credential.helper. It does not stop a read from disk. */
	github: "include" | "exclude";
	floor?: EnvFloor;
	/** Names with these prefixes never reach the child, from any layer. */
	refuseEnvPrefixes?: readonly string[];
	/** These exact names never reach the child, from any layer, whatever the floor. */
	refuseEnvNames?: readonly string[];
}

/** What starts the agent: its binary on PATH, a shipped adapter, or a user-set command. */
export interface LaunchCommand {
	command: string;
	args?: readonly string[];
	env?: Readonly<Record<string, string>>;
	shipped?: boolean;
	companionPath?: string;
}

export interface PlanLaunchInput {
	agent: AgentId;
	/** Absent: no level's overlay, as for a probe or a follow-up that keeps its session's mode. */
	level?: AccessLevel;
	policy: LaunchPolicy;
	launch: LaunchCommand;
	cwd: string;
	/** Per-run folder; the plan's config, data and gh folders live under it. */
	runDir: string;
	hostEnv: Readonly<Record<string, string | undefined>>;
	/** The user's stored values for this agent, decrypted by the product; they win over the host's. */
	stored?: Readonly<Record<string, string>>;
	/** The caller's last word, e.g. a custom model key. Still subject to every refusal. */
	overrides?: Readonly<Record<string, string>>;
	/** The user's own agent config the level's overlay keeps rules from (OpenCode); the product reads it. */
	userConfig?: JsonObject;
	/** The product's MCP gateway; reaches the run only on a row with `gatewayDelivery` (#848). */
	gateway?: AgentRunEnv["gateway"];
	/** Swap the row's facts, as tests and a `local` command do. */
	descriptor?: AgentDescriptor;
}

export type EnvVarState = "not-set" | "key-set" | "from-environment";

export interface LaunchPlan {
	agent: AgentId;
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	/** Each variable the row reads or the user stored: Not set, Key set, or From environment. */
	envState: Record<string, EnvVarState>;
	level: ResolvedLevel | null;
	sessionMeta?: Record<string, unknown>;
	runEnv: AgentRunEnv;
	/** Absolute path → content; `writeLaunchFiles` writes them. */
	files: Record<string, string>;
	/** Empty folders the run needs, such as the excluded GH_CONFIG_DIR. */
	dirs: string[];
}

/** Case-insensitive: Windows env names are, so `prismalens_x` reaches a child as `PRISMALENS_X`. */
function refusal(
	names: readonly string[] = [],
	prefixes: readonly string[] = [],
): (key: string) => boolean {
	const upNames = new Set(names.map((n) => n.toUpperCase()));
	const upPrefixes = prefixes.map((p) => p.toUpperCase());
	return (key) => {
		const up = key.toUpperCase();
		return upNames.has(up) || upPrefixes.some((p) => up.startsWith(p));
	};
}

function userConfigEnv(key: string, value: string | undefined): JsonObject {
	if (!value?.trim()) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
			return parsed as JsonObject;
	} catch {}
	throw new AgentHostError(
		"bad-config-env",
		`${key} must hold a JSON object for the run's config to merge into it`,
	);
}

/**
 * `user` without the permission tool maps `run` rewrites: the run re-lists their patterns after its
 * catch-all, and a key already in `user` would keep its earlier place under the merge (#916).
 */
function withoutRewrittenPermissions(
	user: JsonObject,
	run: JsonObject,
): JsonObject {
	const strip = (own: unknown, rewritten: unknown): unknown => {
		if (!isJsonObject(own) || !isJsonObject(rewritten)) return own;
		return Object.fromEntries(
			Object.entries(own).filter(([tool]) => !(tool in rewritten)),
		);
	};
	const out: JsonObject = { ...user };
	const runPermission = isJsonObject(run.permission) ? run.permission : {};
	if ("permission" in out)
		out.permission = strip(out.permission, runPermission);
	const runAgents = isJsonObject(run.agent) ? run.agent : {};
	if (isJsonObject(out.agent))
		out.agent = Object.fromEntries(
			Object.entries(out.agent).map(([name, own]) => {
				const rewritten = runAgents[name];
				if (!isJsonObject(own) || !isJsonObject(rewritten)) return [name, own];
				return [
					name,
					{ ...own, permission: strip(own.permission, rewritten.permission) },
				];
			}),
		);
	return out;
}

/** A later layer wins. On Windows a name differing only in case is the same variable, and a child gets just one of them. */
function overlay(
	env: Record<string, string>,
	layer: Readonly<Record<string, string>>,
): void {
	for (const [key, value] of Object.entries(layer)) {
		if (process.platform === "win32") {
			const up = key.toUpperCase();
			for (const k of Object.keys(env))
				if (k !== key && k.toUpperCase() === up) delete env[k];
		}
		env[key] = value;
	}
}

function floorEnv(
	floor: EnvFloor,
	host: PlanLaunchInput["hostEnv"],
): Record<string, string> {
	const env: Record<string, string> = {};
	if (floor.mode === "inherit-minus-own-secrets") {
		const own = refusal(floor.ownSecrets.names, floor.ownSecrets.prefixes);
		for (const [key, value] of Object.entries(host))
			if (value !== undefined && !own(key)) env[key] = value;
		return env;
	}
	const allow = [...SAFE_ENV_ALLOWLIST, ...(floor.extraAllow ?? [])];
	for (const key of allow) {
		const value = host[key];
		if (value !== undefined) env[key] = value;
	}
	return env;
}

/** The row's JSON config files with the level's overlay merged into each. */
function levelFiles(
	files: Record<string, string>,
	patch: JsonObject | undefined,
): Record<string, string> {
	if (!patch) return files;
	return Object.fromEntries(
		Object.entries(files).map(([rel, content]) => {
			if (!rel.endsWith(".json")) return [rel, content];
			const base = JSON.parse(content) as JsonObject;
			return [rel, JSON.stringify(mergeConfigPatch(base, patch), null, 2)];
		}),
	);
}

export function planLaunch(input: PlanLaunchInput): LaunchPlan {
	const { policy } = input;
	if (policy.userSetup !== "inherit")
		throw new AgentHostError(
			"user-setup-unsupported",
			`userSetup "${policy.userSetup}" has no rows yet; it is decided with cloud work (#916)`,
		);
	const row = input.descriptor ?? AGENT_REGISTRY[input.agent];
	const host = input.hostEnv;
	const stored = input.stored ?? {};
	const runEnv: AgentRunEnv = {
		configDir: join(input.runDir, "config"),
		dataDir: join(input.runDir, "home"),
		cwd: input.cwd,
		...(input.launch.companionPath
			? { companionPath: shimTarget(input.launch.companionPath) }
			: {}),
		...(input.launch.shipped ? { shipped: true } : {}),
		...(input.gateway && row.gatewayDelivery ? { gateway: input.gateway } : {}),
	};

	const env = floorEnv(policy.floor ?? { mode: "allowlist" }, host);
	for (const key of row.providerKeys) {
		const value = host[key];
		if (value !== undefined) env[key] = value;
	}
	for (const layer of [
		stored,
		input.launch.env ?? {},
		row.acpEnv(runEnv),
		input.overrides ?? {},
	])
		overlay(env, layer);

	const own =
		policy.floor?.mode === "inherit-minus-own-secrets"
			? policy.floor.ownSecrets
			: {};
	const refused = refusal(
		[...(policy.refuseEnvNames ?? []), ...(own.names ?? [])],
		[...(policy.refuseEnvPrefixes ?? []), ...(own.prefixes ?? [])],
	);
	for (const key of Object.keys(env)) if (refused(key)) delete env[key];

	const dirs = [runEnv.configDir, runEnv.dataDir];
	if (policy.github === "exclude") {
		for (const key of GITHUB_TOKEN_VARS) delete env[key];
		const ghDir = join(input.runDir, "gh");
		env.GH_CONFIG_DIR = ghDir;
		dirs.push(ghDir);
		for (const key of Object.keys(env))
			if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key))
				delete env[key];
		// Git reads GIT_CONFIG_* after every file, so an empty helper resets the user's list.
		env.GIT_CONFIG_COUNT = "1";
		env.GIT_CONFIG_KEY_0 = "credential.helper";
		env.GIT_CONFIG_VALUE_0 = "";
	}

	// Only a row that reads the variable, or a user who stored it, is held to it; the host's value is inherited by every row.
	const gateway = env.ANTHROPIC_BASE_URL;
	const readsGateway =
		row.providerKeys.includes("ANTHROPIC_BASE_URL") ||
		stored.ANTHROPIC_BASE_URL !== undefined;
	if (gateway && readsGateway && !isSafeGatewayUrl(gateway))
		throw new AgentHostError(
			"unsafe-gateway-url",
			`ANTHROPIC_BASE_URL must be https unless it points at this machine: ${gateway}`,
		);

	const envState: Record<string, EnvVarState> = {};
	const named = new Set([
		...row.providerKeys,
		...Object.keys(stored),
		...(row.configDir ? [row.configDir.envKey] : []),
	]);
	for (const key of named)
		envState[key] =
			stored[key] !== undefined && env[key] !== undefined
				? "key-set"
				: env[key] !== undefined && host[key] !== undefined
					? "from-environment"
					: "not-set";

	const level = input.level ? resolveLevel(input.agent, input.level) : null;
	const inline = row.configEnv
		? userConfigEnv(row.configEnv.key, env[row.configEnv.key])
		: {};
	const patch = level?.configPatch?.(
		mergeConfigPatch(input.userConfig ?? {}, inline),
	);
	const planned = levelFiles(row.configFiles?.(runEnv) ?? {}, patch);
	if (row.configEnv && planned[row.configEnv.file] !== undefined) {
		const { file, key } = row.configEnv;
		const run = JSON.parse(planned[file] as string) as JsonObject;
		env[key] = JSON.stringify(
			mergeConfigPatch(withoutRewrittenPermissions(inline, run), run),
		);
		delete planned[file];
	}
	const files = Object.fromEntries(
		Object.entries(planned).map(([rel, content]) => [
			join(runEnv.configDir, rel),
			content,
		]),
	);
	const sessionMeta = row.sessionMeta?.();
	return {
		agent: input.agent,
		command: input.launch.command,
		args: [...(input.launch.args ?? []), ...row.acpArgs(runEnv)],
		cwd: input.cwd,
		env,
		envState,
		level,
		...(sessionMeta ? { sessionMeta } : {}),
		runEnv,
		files,
		dirs,
	};
}

/** Creates the plan's folders and writes its files. */
export function writeLaunchFiles(
	plan: Pick<LaunchPlan, "files" | "dirs" | "runEnv">,
): void {
	for (const dir of plan.dirs) mkdirSync(dir, { recursive: true });
	// A run file can hold the gateway bearer: owner-only whatever the umask (#848).
	mkdirSync(plan.runEnv.configDir, { recursive: true, mode: 0o700 });
	chmodSync(plan.runEnv.configDir, 0o700);
	for (const [path, content] of Object.entries(plan.files)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, { mode: 0o600 });
		chmodSync(path, 0o600);
	}
}
