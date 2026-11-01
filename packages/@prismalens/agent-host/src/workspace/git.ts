// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentHostError } from "../errors.js";

const run = promisify(execFile);

/** A remote that accepts the connection and then stalls must not hang a run. */
export const GIT_TIMEOUT_MS = 10 * 60_000;

/** `git rev-parse --local-env-vars` plus the trace and config overrides a parent could leak in (#673). */
const STRIP_EXACT = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_OBJECT_DIRECTORY",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_REPLACE_REF_BASE",
	"GIT_PREFIX",
	"GIT_SHALLOW_FILE",
	"GIT_COMMON_DIR",
	"GIT_NAMESPACE",
	"GIT_CURL_VERBOSE",
	"GIT_ASKPASS",
	"SSH_ASKPASS",
	"LANGUAGE",
]);
const STRIP_PREFIX = ["GIT_TRACE", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

/** An HTTP auth header scoped to one origin, used only on the fetch's own process env. */
export interface FetchCredential {
	/** e.g. `Authorization: Basic …`. */
	header: string;
	/** `https://host[:port]` the header is sent to. */
	scope: string;
}

/** The env of a git child: no prompt, English messages, and the credential only when one is passed. */
export function gitEnv(
	parent: Readonly<Record<string, string | undefined>>,
	credential?: FetchCredential,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(parent)) {
		if (value === undefined || STRIP_EXACT.has(key)) continue;
		if (STRIP_PREFIX.some((p) => key.startsWith(p))) continue;
		env[key] = value;
	}
	Object.assign(env, {
		GIT_TERMINAL_PROMPT: "0",
		// Set but empty: git sees an askpass and runs nothing.
		GIT_ASKPASS: "",
		SSH_ASKPASS_REQUIRE: "never",
		GCM_INTERACTIVE: "never",
		GIT_TRACE_REDACT: "1",
		LC_ALL: "C",
	});
	if (credential) {
		const pairs: [string, string][] = [
			["credential.helper", ""],
			["http.extraheader", ""],
			[
				`http.${credential.scope.replace(/\/+$/, "")}/.extraheader`,
				credential.header,
			],
		];
		env.GIT_CONFIG_COUNT = String(pairs.length);
		pairs.forEach(([key, value], i) => {
			env[`GIT_CONFIG_KEY_${i}`] = key;
			env[`GIT_CONFIG_VALUE_${i}`] = value;
		});
	}
	return env;
}

export interface GitOptions {
	cwd: string;
	env: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export async function git(args: string[], opts: GitOptions): Promise<string> {
	try {
		const { stdout } = await run("git", args, {
			cwd: opts.cwd,
			env: opts.env,
			timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
			maxBuffer: 16 * 1024 * 1024,
			windowsHide: true,
			...(opts.signal ? { signal: opts.signal } : {}),
		});
		return stdout;
	} catch (err) {
		const e = err as Error & { stderr?: string };
		const detail = (e.stderr ?? "").trim() || e.message;
		throw new AgentHostError("git-failed", `git ${args[0] ?? ""}: ${detail}`);
	}
}

/** False only when git confirms `commit` names no commit in `repo` (exit 1); any other failure throws. */
export async function hasCommit(
	repo: string,
	commit: string,
	opts: Omit<GitOptions, "cwd">,
): Promise<boolean> {
	try {
		await run(
			"git",
			[
				"rev-parse",
				"--verify",
				"--quiet",
				"--end-of-options",
				`${commit}^{commit}`,
			],
			{
				cwd: repo,
				env: opts.env,
				timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
				windowsHide: true,
				...(opts.signal ? { signal: opts.signal } : {}),
			},
		);
		return true;
	} catch (err) {
		const e = err as Error & { code?: unknown; stderr?: string };
		if (e.code === 1) return false;
		const detail = (e.stderr ?? "").trim() || e.message;
		throw new AgentHostError("git-failed", `git rev-parse: ${detail}`);
	}
}

/** True when `git` exits 0; for probes such as `cat-file -e`. */
export async function gitOk(
	args: string[],
	opts: GitOptions,
): Promise<boolean> {
	try {
		await git(args, opts);
		return true;
	} catch {
		return false;
	}
}
