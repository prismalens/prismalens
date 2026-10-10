// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agent's own default for each axis, read from the user's settings file
 * (#673 w21 ruling 2026-10-10). Files only: managed, MDM and in-memory values
 * are not seen, and every answer names the file it read. Never throws.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AccessLevel,
	HarnessId,
	RunMode,
} from "@prismalens/config/harness";
import type { LocalDefault } from "@prismalens/contracts/schemas";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import {
	CLAUDE_MANAGED_DIR,
	claudeManagedFiles,
	claudeSettingAt,
} from "./sandbox-check.js";

export interface LocalDefaultOptions {
	platform?: NodeJS.Platform;
	/** Claude Code's managed-settings directory; this platform's by default. */
	claudeManagedDir?: string | null;
	/** Gemini CLI's system settings file; `/etc/gemini-cli/settings.json` on Linux by default. */
	geminiSystemFile?: string | null;
	/** A file that could not be parsed, for the host's debug log. */
	onDebug?: (message: string) => void;
}

type Permission = LocalDefault["permission"];
type Mode = LocalDefault["mode"];
const NONE: LocalDefault = { permission: null, mode: null };

/** `~/x` for a path under the home directory, so the line reads as the user wrote it. */
function shown(path: string, home: string): string {
	return path === home || path.startsWith(`${home}/`)
		? `~${path.slice(home.length)}`
		: path;
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** JSON with comments; null when absent or unparseable. */
function readJsonc(
	path: string,
	onDebug?: (m: string) => void,
): Record<string, unknown> | null {
	const text = readText(path);
	if (text === null) return null;
	const errors: ParseError[] = [];
	const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
	if (errors.length || !value || typeof value !== "object") {
		onDebug?.(`could not parse ${path}`);
		return null;
	}
	return value as Record<string, unknown>;
}

function at(obj: unknown, ...path: string[]): unknown {
	let value = obj;
	for (const key of path)
		value =
			value && typeof value === "object"
				? (value as Record<string, unknown>)[key]
				: undefined;
	return value;
}

/** Claude Code and the adapter accept these spellings of a mode (claude-agent-acp 0.81.1 modes.js). */
const CLAUDE_ALIASES: Record<string, string> = {
	manual: "default",
	default: "default",
	acceptedits: "acceptEdits",
	auto: "auto",
	bypass: "bypassPermissions",
	bypasspermissions: "bypassPermissions",
	plan: "plan",
	dontask: "dontAsk",
};

const CLAUDE_LEVEL: Record<string, AccessLevel> = {
	default: "supervised",
	acceptEdits: "auto-edits",
	auto: "auto",
	bypassPermissions: "full-access",
};

function claude(
	env: NodeJS.ProcessEnv,
	home: string,
	opts: LocalDefaultOptions,
): LocalDefault {
	const managedDir =
		opts.claudeManagedDir !== undefined
			? opts.claudeManagedDir
			: (CLAUDE_MANAGED_DIR[opts.platform ?? process.platform] ?? null);
	const user = join(
		env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
		"settings.json",
	);
	const isString = (v: unknown) => typeof v === "string";
	const key = ["permissions", "defaultMode"];
	const found =
		claudeSettingAt(claudeManagedFiles(managedDir), key, isString) ??
		claudeSettingAt([user], key, isString);
	if (!found) return NONE;
	const value = found.value as string;
	const file = shown(found.file, home);
	const id = CLAUDE_ALIASES[value.toLowerCase()];
	const known = id !== undefined;
	return {
		permission: { level: (id && CLAUDE_LEVEL[id]) || null, file, value },
		mode: {
			mode: !known ? null : id === "plan" ? "plan" : "execute",
			file,
			value,
		},
	};
}

const CODEX_LEVEL: Record<string, AccessLevel> = {
	"read-only": "supervised",
	"workspace-write": "auto-edits",
	"danger-full-access": "full-access",
};

function codex(
	env: NodeJS.ProcessEnv,
	home: string,
	onDebug?: (m: string) => void,
): LocalDefault {
	const path = join(env.CODEX_HOME ?? join(home, ".codex"), "config.toml");
	const text = readText(path);
	if (text === null) return NONE;
	let config: Record<string, unknown>;
	try {
		config = parseToml(text) as Record<string, unknown>;
	} catch {
		onDebug?.(`could not parse ${path}`);
		return NONE;
	}
	const profileName = config.profile;
	const profile =
		typeof profileName === "string"
			? at(config, "profiles", profileName)
			: undefined;
	const pick = (k: string): string | undefined => {
		const v = at(profile, k) ?? config[k];
		return typeof v === "string" ? v : undefined;
	};
	const sandbox = pick("sandbox_mode");
	if (!sandbox) return NONE;
	const approval = pick("approval_policy");
	const asks = approval === undefined || approval === "on-request";
	const permission: Permission = {
		level: asks ? (CODEX_LEVEL[sandbox] ?? null) : null,
		file: shown(path, home),
		value: approval ? `${sandbox}, ${approval}` : sandbox,
	};
	return { permission, mode: null };
}

const GEMINI_UNTRUSTED = "Gemini CLI runs the copy untrusted here";

function gemini(
	env: NodeJS.ProcessEnv,
	home: string,
	opts: LocalDefaultOptions,
): LocalDefault {
	const user = join(env.GEMINI_CLI_HOME ?? home, ".gemini", "settings.json");
	const system =
		opts.geminiSystemFile !== undefined
			? opts.geminiSystemFile
			: (opts.platform ?? process.platform) === "linux"
				? "/etc/gemini-cli/settings.json"
				: null;
	let found: { value: string; file: string } | null = null;
	for (const file of [user, system]) {
		if (!file) continue;
		const value = at(
			readJsonc(file, opts.onDebug),
			"general",
			"defaultApprovalMode",
		);
		if (typeof value === "string") found = { value, file };
	}
	if (!found) return NONE;
	const { value } = found;
	const file = shown(found.file, home);
	const permission: Permission =
		value === "default"
			? { level: "supervised", file, value }
			: value === "auto_edit"
				? { level: null, file, value, reason: GEMINI_UNTRUSTED }
				: { level: null, file, value };
	const runMode: RunMode | null =
		value === "plan"
			? "plan"
			: value === "default" || value === "auto_edit"
				? "execute"
				: null;
	return { permission, mode: { mode: runMode, file, value } };
}

const OPENCODE_FILES = ["opencode.json", "opencode.jsonc", "config.json"];

function opencode(
	env: NodeJS.ProcessEnv,
	home: string,
	onDebug?: (m: string) => void,
): LocalDefault {
	const dir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
	for (const name of OPENCODE_FILES) {
		const path = join(dir, name);
		if (readText(path) === null) continue;
		const value = at(readJsonc(path, onDebug), "default_agent");
		if (typeof value !== "string") return NONE;
		const mode: Mode = {
			mode: value === "plan" ? "plan" : value === "build" ? "execute" : null,
			file: shown(path, home),
			value,
		};
		return { permission: null, mode };
	}
	return NONE;
}

/** What the user's own settings file names for `harness`, on both axes. */
export function localDefault(
	harness: HarnessId,
	env: NodeJS.ProcessEnv = process.env,
	opts: LocalDefaultOptions = {},
): LocalDefault {
	const home = env.HOME ?? homedir();
	try {
		switch (harness) {
			case "claude-code":
				return claude(env, home, opts);
			case "codex":
				return codex(env, home, opts.onDebug);
			case "gemini":
				return gemini(env, home, opts);
			case "opencode":
				return opencode(env, home, opts.onDebug);
			default:
				return NONE;
		}
	} catch (err) {
		opts.onDebug?.(
			`local default for ${harness}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return NONE;
	}
}
