// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Isolation: the agent's own switches that keep a launch from running the user's and the
 * repo's hooks, plugins and MCP servers (#1180 §2 R1, §3.4). Pure: the caller hands in the
 * file reader, so the browser-safe registry can hold the values.
 */
import { isJsonObject, type JsonObject, mergeConfigPatch } from "./levels.js";

export interface IsolationContext {
	/** MCP server names found in the agent's config files (§3.1); each is turned off by name. */
	mcp: readonly string[];
	/** PrismaLens's own MCP server names on this launch (the gateway, the shared set); they stay on. */
	ours: readonly string[];
	/** The planned env so far, before this isolation. */
	env: Readonly<Record<string, string>>;
	/** Absolute path of `rel` inside the run folder, where `files` are written. */
	runPath: (rel: string) => string;
	platform: string;
	/** The OS user profile, where `~` config lives. */
	home: string;
	/** A file's text, null when it does not exist; throws when it exists but cannot be read. */
	read: (path: string) => string | null;
	/** The agent CLI's version, when the caller read it; null when it could not. */
	version?: string | null;
}

export interface Isolation {
	/** A reason this launch cannot be isolated this time, else null. */
	unavailable?: (ctx: IsolationContext) => string | null;
	/** Deep-merged into the `session/new` `_meta`. */
	meta?: (ctx: IsolationContext) => Record<string, unknown>;
	env?: (ctx: IsolationContext) => Record<string, string>;
	/** Appended to the launch's argv. */
	args?: (ctx: IsolationContext) => string[];
	/** Deep-merged into the JSON object held by the env var `key`. */
	config?: { key: string; patch: (ctx: IsolationContext) => JsonObject };
	/** Run-folder relative path to content. */
	files?: (ctx: IsolationContext) => Record<string, string>;
}

/** What one isolation adds to a launch, or why it cannot. */
export type IsolationLayer =
	| {
			meta: Record<string, unknown>;
			env: Record<string, string>;
			args: string[];
			config: Record<string, JsonObject>;
			files: Record<string, string>;
	  }
	| { unavailable: string };

export function resolveIsolation(
	isolations: readonly Isolation[],
	ctx: IsolationContext,
): IsolationLayer {
	const out = {
		meta: {} as JsonObject,
		env: {} as Record<string, string>,
		args: [] as string[],
		config: {} as Record<string, JsonObject>,
		files: {} as Record<string, string>,
	};
	for (const iso of isolations) {
		const reason = iso.unavailable?.(ctx) ?? null;
		if (reason) return { unavailable: reason };
		if (iso.meta)
			out.meta = mergeConfigPatch(out.meta, iso.meta(ctx) as JsonObject);
		Object.assign(out.env, iso.env?.(ctx) ?? {});
		out.args.push(...(iso.args?.(ctx) ?? []));
		if (iso.config) {
			const { key, patch } = iso.config;
			out.config[key] = mergeConfigPatch(out.config[key] ?? {}, patch(ctx));
		}
		Object.assign(out.files, iso.files?.(ctx) ?? {});
	}
	return out;
}

export interface IsolatablePlan {
	env: Record<string, string>;
	args: string[];
	sessionMeta?: Record<string, unknown>;
}

/** `plan` with `layer` merged in: meta and JSON env values deep, plain env values replaced. */
export function mergeIsolation<P extends IsolatablePlan>(
	plan: P,
	layer: Exclude<IsolationLayer, { unavailable: string }>,
): P {
	const env = { ...plan.env, ...layer.env };
	for (const [key, patch] of Object.entries(layer.config)) {
		const raw = env[key]?.trim();
		let base: JsonObject = {};
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (!isJsonObject(parsed))
				throw new Error(`${key} must hold a JSON object to isolate the launch`);
			base = parsed;
		}
		env[key] = JSON.stringify(mergeConfigPatch(base, patch));
	}
	const meta = Object.keys(layer.meta).length
		? mergeConfigPatch(
				(plan.sessionMeta ?? {}) as JsonObject,
				layer.meta as JsonObject,
			)
		: plan.sessionMeta;
	return {
		...plan,
		env,
		args: [...plan.args, ...layer.args],
		...(meta ? { sessionMeta: meta } : {}),
	};
}

// ---------------------------------------------------------------- Claude Code

/** Claude Code's managed (policy) folder per platform, as its CLI 2.1.331 resolves it. */
export function claudeManagedDir(platform: string): string {
	if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
	return "/etc/claude-code";
}

function joinFor(platform: string, dir: string, name: string): string {
	return `${dir}${platform === "win32" ? "\\" : "/"}${name}`;
}

/** A `managed-mcp.json` Claude reads as one: JSON whose `mcpServers` is an object. */
export function claudeManagedMcpParses(ctx: IsolationContext): boolean {
	try {
		const text = ctx.read(
			joinFor(ctx.platform, claudeManagedDir(ctx.platform), "managed-mcp.json"),
		);
		if (text === null) return false;
		const parsed: unknown = JSON.parse(text);
		return isJsonObject(parsed) && isJsonObject(parsed.mcpServers);
	} catch {
		return false;
	}
}

/**
 * The options a check adds for Claude Code. Under `strictMcpConfig` Claude exits at start when
 * a managed MCP file applies, and that file already decides which servers run.
 */
export function claudeCheckOptions(ctx: IsolationContext): JsonObject {
	return {
		...(claudeManagedMcpParses(ctx) ? {} : { strictMcpConfig: true }),
		settings: { disableAllHooks: true },
	};
}

/** claude.ai connectors come from the account, not a config file. */
export const CLAUDE_CHECK_ENV = {
	ENABLE_CLAUDEAI_MCP_SERVERS: "false",
} as const;

export const claudeProbeIsolation: Isolation = {
	meta: (ctx) => ({ claudeCode: { options: claudeCheckOptions(ctx) } }),
	env: () => ({ ...CLAUDE_CHECK_ENV }),
};

/** Claude settings keys that sign in (settings reference, CLI 2.1.331). */
export const CLAUDE_SIGN_IN_SETTINGS = [
	"apiKeyHelper",
	"awsAuthRefresh",
	"awsCredentialExport",
	"gcpAuthRefresh",
] as const;

/** `env` entries in Claude settings that pick a provider, key or route. */
const CLAUDE_SIGN_IN_ENV =
	/^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|GOOGLE_|VERTEX_|CLOUD_ML_)/i;

/** The user's Claude `settings.json` carries a sign-in input the clean profile would drop. */
export function claudeUserSettingsSignIn(ctx: IsolationContext): boolean {
	const dir =
		ctx.env.CLAUDE_CONFIG_DIR || joinFor(ctx.platform, ctx.home, ".claude");
	let parsed: unknown;
	try {
		const text = ctx.read(joinFor(ctx.platform, dir, "settings.json"));
		if (text === null) return false;
		parsed = JSON.parse(text);
	} catch {
		return true;
	}
	if (!isJsonObject(parsed)) return true;
	if (CLAUDE_SIGN_IN_SETTINGS.some((k) => parsed[k] !== undefined)) return true;
	const env = parsed.env;
	return (
		isJsonObject(env) &&
		Object.keys(env).some((k) => CLAUDE_SIGN_IN_ENV.test(k))
	);
}

/**
 * User settings unread, hooks and plugins off, only PrismaLens's MCP servers. `--safe-mode`
 * is not used: in 2.1.331 it also drops the servers PrismaLens passes over ACP.
 */
export const claudeCleanIsolation: Isolation = {
	unavailable: (ctx) =>
		claudeUserSettingsSignIn(ctx) ? "Your Claude settings carry sign-in" : null,
	meta: (ctx) => ({
		claudeCode: {
			options: {
				settingSources: ["project", "local"],
				...(claudeManagedMcpParses(ctx) ? {} : { strictMcpConfig: true }),
				settings: { disableAllHooks: true, enabledPlugins: {} },
			},
		},
	}),
	env: () => ({ ...CLAUDE_CHECK_ENV }),
};

// ---------------------------------------------------------------- Codex

/** Hooks, plugins (and the MCP servers their manifests declare) and each named server off. */
export function codexCheckConfig(mcp: readonly string[]): JsonObject {
	return {
		features: { hooks: false, plugins: false },
		...(mcp.length
			? {
					mcp_servers: Object.fromEntries(
						mcp.map((n) => [n, { enabled: false }]),
					),
				}
			: {}),
	};
}

/** `codexCheckConfig` as `-c key=value` pairs for a Codex CLI started directly. */
export function codexConfigArgs(mcp: readonly string[]): string[] {
	const key = (n: string) =>
		/^[A-Za-z0-9_-]+$/.test(n) ? n : JSON.stringify(n);
	return [
		"-c",
		"features.hooks=false",
		"-c",
		"features.plugins=false",
		...mcp.flatMap((n) => ["-c", `mcp_servers.${key(n)}.enabled=false`]),
	];
}

/** codex-acp reads its config overrides from this env var, not `-c`. */
export const CODEX_CONFIG_ENV = "CODEX_CONFIG";

export const codexProbeIsolation: Isolation = {
	config: { key: CODEX_CONFIG_ENV, patch: (ctx) => codexCheckConfig(ctx.mcp) },
};

export const codexCleanIsolation: Isolation = codexProbeIsolation;

// ---------------------------------------------------------------- OpenCode

/** `OPENCODE_PURE` empties the external plugin list in 1.19.6 and is gone in 2.4.1. */
export function opencodeHonoursPure(
	version: string | null | undefined,
): boolean {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
	if (!m) return false;
	const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return maj === 1 && (min > 19 || (min === 19 && pat >= 6));
}

const opencodeMcpOff = (mcp: readonly string[]): JsonObject =>
	mcp.length
		? { mcp: Object.fromEntries(mcp.map((n) => [n, { enabled: false }])) }
		: {};

export const opencodeProbeIsolation: Isolation = {
	unavailable: (ctx) =>
		opencodeHonoursPure(ctx.version)
			? null
			: `OpenCode ${ctx.version ?? "of unknown version"} has no switch for its plugins`,
	env: () => ({ OPENCODE_PURE: "1" }),
	config: {
		key: "OPENCODE_CONFIG_CONTENT",
		patch: (ctx) => opencodeMcpOff(ctx.mcp),
	},
};

export const opencodeCleanIsolation: Isolation = {
	...opencodeProbeIsolation,
	env: () => ({ OPENCODE_PURE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1" }),
};

// ---------------------------------------------------------------- Gemini CLI

/** Gemini CLI 0.64.0 `getSystemSettingsPath`. */
export function geminiSystemSettingsPath(
	env: Readonly<Record<string, string>>,
	platform: string,
): string {
	if (env.GEMINI_CLI_SYSTEM_SETTINGS_PATH)
		return env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
	if (platform === "darwin")
		return "/Library/Application Support/GeminiCli/settings.json";
	if (platform === "win32") return "C:\\ProgramData\\gemini-cli\\settings.json";
	return "/etc/gemini-cli/settings.json";
}

/** Gemini CLI 0.64.0 `getSystemDefaultsPath`: beside the system settings file unless set. */
export function geminiSystemDefaultsPath(
	env: Readonly<Record<string, string>>,
	platform: string,
): string {
	if (env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH)
		return env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH;
	const settings = geminiSystemSettingsPath(env, platform);
	const cut = Math.max(settings.lastIndexOf("/"), settings.lastIndexOf("\\"));
	return joinFor(platform, settings.slice(0, cut), "system-defaults.json");
}

const GEMINI_SYSTEM_COPY = "gemini-system-settings.json";

/** The system settings file, or `{}` when there is none; throws when it exists and is not a JSON object. */
function geminiSystemSettings(ctx: IsolationContext): JsonObject {
	const text = ctx.read(geminiSystemSettingsPath(ctx.env, ctx.platform));
	if (text === null) return {};
	const parsed: unknown = JSON.parse(text);
	if (!isJsonObject(parsed)) throw new Error("not a JSON object");
	return parsed;
}

export const geminiProbeIsolation: Isolation = {
	unavailable: (ctx) => {
		try {
			geminiSystemSettings(ctx);
			return null;
		} catch {
			return "Gemini CLI's system settings file could not be read";
		}
	},
	// Untrusted before any folder rule, so its MCP servers stay off even with folder trust off.
	env: (ctx) => ({
		GEMINI_CLI_TRUST_WORKSPACE: "false",
		GEMINI_CLI_SYSTEM_SETTINGS_PATH: ctx.runPath(GEMINI_SYSTEM_COPY),
		GEMINI_CLI_SYSTEM_DEFAULTS_PATH: geminiSystemDefaultsPath(
			ctx.env,
			ctx.platform,
		),
	}),
	// System settings win over user and project ones; the copy keeps the admin's other keys.
	files: (ctx) => ({
		[GEMINI_SYSTEM_COPY]: JSON.stringify(
			mergeConfigPatch(geminiSystemSettings(ctx), {
				hooksConfig: { enabled: false },
			}),
			null,
			2,
		),
	}),
};

/** No extensions, and only PrismaLens's own MCP servers; flags in Gemini CLI 0.64.0. */
export const geminiCleanIsolation: Isolation = {
	...geminiProbeIsolation,
	env: (ctx) => {
		const { GEMINI_CLI_TRUST_WORKSPACE: _trust, ...rest } =
			geminiProbeIsolation.env?.(ctx) ?? {};
		return rest;
	},
	args: (ctx) => [
		"-e",
		"none",
		"--allowed-mcp-server-names",
		...new Set(["prismalens", ...ctx.ours]),
	],
};
