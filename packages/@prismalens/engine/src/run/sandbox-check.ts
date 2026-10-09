// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Does this machine run the agent in its own OS sandbox, per mode (#673 w51)?
 * The agent's own mode decides what it asks, and every ask reaches the operator
 * (#673 w21); only a sandbox the agent itself enforces holds without a person.
 * `enforced` comes from a local probe, never a mode name.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type HarnessId,
	runsInSandbox,
	type SandboxCheck,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import { buildChildEnv, killProcessTree } from "../launch/process.js";

export type SandboxChecks = Record<string, SandboxCheck>;

export const SANDBOX_PROBE_TIMEOUT_MS = 5_000;
const MARKER = "pl-sandbox-ran";

export interface ProbeOutput {
	stdout: string;
	stderr: string;
	timedOut: boolean;
	/** The spawn error, when the command never ran. */
	error?: string;
}

export type ProbeRunner = (
	command: string,
	args: string[],
	opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<ProbeOutput>;

/** The Codex binary codex-acp runs: its bundled `@openai/codex`, else `codex` on PATH as a stand-in. */
export interface CodexCommand {
	command: string;
	args: string[];
	standIn: boolean;
}

export interface SandboxCheckOptions {
	/** The env the run hands the agent; the probe sees the same HOME and CODEX_HOME. */
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	run?: ProbeRunner;
	locateCodex?: () => CodexCommand | null;
	/** Claude Code's managed-settings directory; defaults to this platform's. */
	claudeManagedDir?: string | null;
	/** The user's Claude Code settings file; defaults to `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`. */
	claudeUserSettings?: string | null;
	platform?: NodeJS.Platform;
}

const runProbe: ProbeRunner = (command, args, { cwd, env, timeoutMs }) =>
	new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		const done = (error?: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ stdout, stderr, timedOut, ...(error ? { error } : {}) });
		};
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const timer = setTimeout(() => {
			timedOut = true;
			killProcessTree(child, "SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (c: Buffer) => {
			stdout += c.toString();
		});
		child.stderr.on("data", (c: Buffer) => {
			stderr += c.toString();
		});
		child.on("error", (err) => done(err.message));
		child.on("close", () => done());
	});

export function locateCodex(
	path = process.env.PATH ?? "",
): CodexCommand | null {
	const acp = resolveOnPath("codex-acp", path);
	if (acp) {
		try {
			let dir = dirname(realpathSync(acp));
			for (let i = 0; i < 6; i++, dir = dirname(dir)) {
				const pkg = join(dir, "package.json");
				if (!existsSync(pkg)) continue;
				const { name } = JSON.parse(readFileSync(pkg, "utf8")) as {
					name?: string;
				};
				if (name !== "@agentclientprotocol/codex-acp") continue;
				// codex-acp src/CodexCli.ts runs this file with node unless CODEX_PATH, which the child env never carries.
				const js = createRequire(pkg).resolve("@openai/codex/bin/codex.js");
				return { command: process.execPath, args: [js], standIn: false };
			}
		} catch {
			// No bundled codex to find: fall back to PATH.
		}
	}
	const codex = resolveOnPath("codex", path);
	return codex ? { command: codex, args: [], standIn: true } : null;
}

function lastLine(text: string): string {
	const line = text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
	return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/** What one `codex sandbox -P :read-only` write outside the workspace showed. */
export function readCodexProbe(
	run: ProbeOutput & { wrote: boolean },
	timeoutMs: number,
	standIn: boolean,
): SandboxCheck {
	const via = standIn ? " (checked with the codex on PATH)" : "";
	if (run.timedOut)
		return {
			state: "unknown",
			reason: `Codex's sandbox check got no answer in ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
		};
	if (run.error)
		return {
			state: "unknown",
			reason: `Codex's sandbox check could not start: ${run.error}`,
		};
	if (!run.stdout.includes(MARKER)) {
		const tail = lastLine(run.stderr);
		return {
			state: "unknown",
			reason: `Codex's sandbox did not run the check${tail ? `: ${tail}` : ""}`,
		};
	}
	return run.wrote
		? {
				state: "none",
				reason: `Codex's sandbox let a test write outside the workspace through${via}`,
			}
		: {
				state: "enforced",
				reason: `Codex's sandbox refused a test write outside the workspace${via}`,
			};
}

export async function probeCodexSandbox(
	opts: SandboxCheckOptions = {},
): Promise<SandboxCheck> {
	if ((opts.platform ?? process.platform) === "win32")
		return {
			state: "unknown",
			reason: "PrismaLens does not check Codex's Windows sandbox",
		};
	const codex = (opts.locateCodex ?? locateCodex)();
	if (!codex)
		return {
			state: "unknown",
			reason: "No codex binary found to check its sandbox with",
		};
	const timeoutMs = opts.timeoutMs ?? SANDBOX_PROBE_TIMEOUT_MS;
	const dir = mkdtempSync(join(tmpdir(), "pl-sandbox-"));
	const workspace = join(dir, "workspace");
	const outside = join(dir, "outside");
	mkdirSync(workspace);
	try {
		const run = await (opts.run ?? runProbe)(
			codex.command,
			[
				...codex.args,
				"sandbox",
				"-P",
				":read-only",
				"-C",
				workspace,
				"--",
				"/bin/sh",
				"-c",
				`echo ${MARKER}; echo x > "$1"`,
				"sh",
				outside,
			],
			{ cwd: workspace, env: buildChildEnv(opts.env), timeoutMs },
		);
		return readCodexProbe(
			{ ...run, wrote: existsSync(outside) },
			timeoutMs,
			codex.standIn,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const CLAUDE_MANAGED_DIR: Partial<Record<NodeJS.Platform, string>> = {
	linux: "/etc/claude-code",
	darwin: "/Library/Application Support/ClaudeCode",
};

/** `sandbox.enabled` as the last of `files` that sets it says; undefined when none does. */
function sandboxSetting(files: readonly string[]): boolean | undefined {
	let enabled: boolean | undefined;
	for (const file of files) {
		try {
			const value = (
				JSON.parse(readFileSync(file, "utf8")) as {
					sandbox?: { enabled?: unknown };
				}
			).sandbox?.enabled;
			if (typeof value === "boolean") enabled = value;
		} catch {
			// Absent or unreadable: Claude Code reads nothing from it either.
		}
	}
	return enabled;
}

/** `sandbox.enabled` from managed-settings.json, then managed-settings.d/*.json in name order; undefined when none sets it. */
export function managedSandboxSetting(dir: string | null): boolean | undefined {
	if (!dir) return undefined;
	const files = [join(dir, "managed-settings.json")];
	try {
		const dropIns = join(dir, "managed-settings.d");
		for (const f of readdirSync(dropIns).sort())
			if (f.endsWith(".json") && !f.startsWith("."))
				files.push(join(dropIns, f));
	} catch {
		// No drop-in directory.
	}
	return sandboxSetting(files);
}

/** The settings file Claude Code reads as the user's, for the run's env. */
export function claudeUserSettingsPath(env: NodeJS.ProcessEnv = {}): string {
	const dir =
		env.CLAUDE_CONFIG_DIR ??
		process.env.CLAUDE_CONFIG_DIR ??
		join(env.HOME ?? homedir(), ".claude");
	return join(dir, "settings.json");
}

function claudeCodeSandbox(opts: SandboxCheckOptions): SandboxCheck {
	const dir =
		opts.claudeManagedDir !== undefined
			? opts.claudeManagedDir
			: (CLAUDE_MANAGED_DIR[opts.platform ?? process.platform] ?? null);
	const userFile =
		opts.claudeUserSettings !== undefined
			? opts.claudeUserSettings
			: claudeUserSettingsPath(opts.env);
	// The run loads settingSources ["user"]; managed settings win over it (Agent SDK docs, settingSources).
	const managed = managedSandboxSetting(dir);
	const user = userFile ? sandboxSetting([userFile]) : undefined;
	const on = managed ?? user ?? false;
	if (on)
		return {
			state: "unknown",
			reason: `${managed !== undefined ? "Managed settings turn" : "Your settings turn"} Claude Code's sandbox on; PrismaLens has not checked it starts here`,
		};
	return {
		state: "none",
		reason:
			managed === false
				? "Managed settings turn Claude Code's sandbox off"
				: "Claude Code's sandbox is off in your settings",
	};
}

const NO_SANDBOX: Partial<Record<HarnessId, SandboxCheck>> = {
	opencode: { state: "none", reason: "OpenCode has no sandbox" },
	deepagents: {
		state: "none",
		reason: "deepagents runs commands on this machine with no sandbox",
	},
	gemini: {
		state: "unknown",
		reason: "PrismaLens does not check Gemini CLI's sandbox yet",
	},
};

/** One check per mode id; Codex's probe runs once and covers every mode its sandbox holds. */
export async function checkSandbox(
	harness: HarnessId,
	modes: readonly string[],
	opts: SandboxCheckOptions = {},
): Promise<SandboxChecks> {
	const out: SandboxChecks = {};
	let probe: Promise<SandboxCheck> | undefined;
	for (const mode of modes) {
		if (harness === "codex") {
			if (runsInSandbox(harness, mode)) {
				probe ??= probeCodexSandbox(opts);
				out[mode] = await probe;
			} else
				out[mode] =
					mode === "agent-full-access"
						? {
								state: "none",
								reason: "Full access runs Codex outside its sandbox",
							}
						: {
								state: "unknown",
								reason:
									"Codex does not say whether this mode runs in its sandbox",
							};
		} else if (harness === "claude-code") out[mode] = claudeCodeSandbox(opts);
		else
			out[mode] = NO_SANDBOX[harness] ?? {
				state: "unknown",
				reason: "Not checked",
			};
	}
	return out;
}
