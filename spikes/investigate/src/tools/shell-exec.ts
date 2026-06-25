// The one data-gathering tool: a deny-by-default, READ-ONLY shell executor.
//
// Safety model (the spike's most security-critical surface):
//   1. execFile (NO shell) — argv is passed straight to the binary, so pipes,
//      redirects, substitution, and chaining are impossible.
//   2. Binary allowlist — a command runs only if its binary is a key in the allowlist.
//   3. Subcommand allowlist — if a command lists `subcommands`, args[0] must be one.
//   4. Mutating-token denylist — reject obviously-mutating verbs/flags anywhere in args
//      (defense in depth, independent of the allowlist).
//   5. Metacharacter denylist — reject shell metacharacters (defense in depth).
//   6. Sanitized child env — our model API keys and LD_*/DYLD_* preload vars are stripped
//      from the env the binary inherits, so a compromised CLI can neither read our secret
//      nor inject a preloaded library. The user's OWN tool creds (KUBECONFIG, GH_TOKEN, …)
//      pass through so their CLIs still work.
//   7. Timeout + output cap.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { ToolDef } from "../types.js";

const execFileAsync = promisify(execFile);

interface CommandRule {
	subcommands?: string[];
	description?: string;
}
export interface Allowlist {
	commands: Record<string, CommandRule>;
}

const OUTPUT_LIMIT = 8000; // chars returned to the model
const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1024 * 1024; // 1 MB

// Mutating / dangerous verbs — rejected anywhere in args (trimmed, and with leading
// dashes stripped, so ` delete ` and `--force` are both caught). The subcommand
// allowlist is the primary guard; this is independent defense in depth.
const MUTATING_TOKEN =
	/^(delete|del|rm|remove|create|apply|edit|patch|replace|set|scale|drain|cordon|uncordon|rollout|exec|attach|cp|mv|annotate|label|taint|sudo|kill|stop|start|restart|reboot|prune|push|commit|merge|reset|write|put|post|force|f)$/i;
// Shell metacharacters — impossible to act on via execFile, rejected as defense in depth.
const SHELL_META = /[;'"&|`$<>(){}\\\n]/;

// Env vars never exposed to a spawned binary: our model secrets + dynamic-loader
// injection vectors. Everything else (PATH, HOME, KUBECONFIG, GH_TOKEN, AWS_*, …) passes
// through so the user's read-only CLIs keep working.
const SECRET_ENV = new Set([
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
]);
const INJECT_ENV = /^(LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH)$/;

function childEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (SECRET_ENV.has(k) || INJECT_ENV.test(k)) continue;
		env[k] = v;
	}
	return env;
}

export function loadAllowlist(file: string): Allowlist {
	const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Allowlist>;
	if (!raw.commands || typeof raw.commands !== "object") {
		throw new Error(`Allowlist "${file}" has no "commands" object.`);
	}
	return { commands: raw.commands };
}

export interface ShellResult {
	output: string;
	isError: boolean;
}

/** Deny-by-default validation. Returns a rejection reason, or null if allowed. */
export function checkCommand(
	allowlist: Allowlist,
	command: string,
	args: string[],
): string | null {
	const rule = allowlist.commands[command];
	if (!rule) {
		const allowed = Object.keys(allowlist.commands).join(", ") || "(none)";
		return `Command "${command}" is not in the read-only allowlist. Allowed binaries: ${allowed}.`;
	}
	for (const a of args) {
		if (SHELL_META.test(a)) return `Argument "${a}" contains a forbidden shell metacharacter.`;
		const bare = a.trim().replace(/^-+/, "");
		if (MUTATING_TOKEN.test(a.trim()) || MUTATING_TOKEN.test(bare)) {
			return `Argument "${a}" looks like a mutating operation; only read-only commands are allowed.`;
		}
	}
	const subs = rule.subcommands ?? [];
	if (subs.length > 0) {
		const first = args[0];
		if (first === undefined || !subs.includes(first)) {
			return `"${command} ${first ?? ""}" is not an allowed read-only subcommand. Allowed: ${subs.join(", ")}.`;
		}
	}
	return null;
}

export async function runShellExec(
	allowlist: Allowlist,
	command: string,
	args: string[],
): Promise<ShellResult> {
	const rejection = checkCommand(allowlist, command, args);
	if (rejection) return { output: rejection, isError: true };
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_BUFFER,
			encoding: "utf8",
			shell: false,
			env: childEnv(),
		});
		const combined = [String(stdout), String(stderr)].filter((s) => s.trim()).join("\n").trim();
		return { output: truncate(combined || "(no output)"), isError: false };
	} catch (err) {
		const e = err as { stderr?: string | Buffer; message?: string };
		const detail = (e.stderr && String(e.stderr).trim()) || e.message || String(err);
		return { output: truncate(`command failed: ${detail}`), isError: true };
	}
}

function truncate(s: string): string {
	return s.length > OUTPUT_LIMIT ? `${s.slice(0, OUTPUT_LIMIT)}\n…(truncated)` : s;
}

export const shellExecTool: ToolDef = {
	name: "shell_exec",
	description:
		"Run ONE read-only shell command from the configured allowlist to gather evidence. Provide the binary and its argument array SEPARATELY (no pipes, redirects, or shell features). Mutating commands are rejected. Returns combined stdout/stderr (truncated).",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "Binary to run, e.g. kubectl" },
			args: {
				type: "array",
				items: { type: "string" },
				description: 'Arguments as an array, e.g. ["get","pods","-n","prod"]',
			},
		},
		required: ["command", "args"],
	},
};
