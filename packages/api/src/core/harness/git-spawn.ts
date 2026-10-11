// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { type GitEnvInput, gitEnv } from "./git-env.js";
import { scrubGitStderr } from "./git-failure.js";

const MAX_OUTPUT = 16 * 1024 * 1024;

export const GIT_PROBE_TIMEOUT_MS = 5_000;
export const GIT_LS_REMOTE_TIMEOUT_MS = 30_000;
/** A remote that accepts the connection and then stalls must not hang a save or a run. */
export const GIT_TIMEOUT_MS = 10 * 60_000;

export interface SpawnGitOptions {
	env: Record<string, string>;
	cwd?: string;
	timeoutMs: number;
	signal?: AbortSignal;
	/** Written to stdin, which is otherwise closed. */
	input?: string;
	/** Read stdout line by line instead of collecting it; the result's stdout is then "". */
	onStdoutLine?: (line: string) => void;
}

export interface GitOutput {
	stdout: string;
	stderr: string;
}

/** A git child that exited non-zero, timed out or overflowed. `stderr` is raw: scrub it before showing it. */
export class GitSpawnError extends Error {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly stderr: string,
		readonly timedOut: boolean,
	) {
		super(message);
		this.name = "GitSpawnError";
	}
}

/**
 * git as the leader of its own session, so a helper or ssh has no tty to prompt on,
 * and a timeout kills the whole group: a helper git started outlives a kill of git alone (#673).
 */
export function spawnGit(
	args: string[],
	opts: SpawnGitOptions,
): Promise<GitOutput> {
	opts.signal?.throwIfAborted();
	const group = process.platform !== "win32";
	const child = spawn("git", args, {
		cwd: opts.cwd,
		env: opts.env,
		detached: group,
		stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
	});
	const kill = () => {
		try {
			if (group && child.pid) process.kill(-child.pid, "SIGKILL");
			else child.kill("SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	};
	return new Promise<GitOutput>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let size = 0;
		let partial = "";
		let failure: Error | null = null;
		const fail = (err: Error) => {
			failure ??= err;
			kill();
		};
		const grow = (n: number) => {
			size += n;
			if (size > MAX_OUTPUT)
				fail(new GitSpawnError("git output exceeded 16 MiB", null, "", false));
		};
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			grow(chunk.length);
			if (!opts.onStdoutLine) {
				stdout += chunk;
				return;
			}
			const lines = (partial + chunk).split("\n");
			partial = lines.pop() ?? "";
			for (const line of lines) opts.onStdoutLine(line);
		});
		child.stderr?.on("data", (chunk: string) => {
			grow(chunk.length);
			stderr += chunk;
		});
		const timer = setTimeout(
			() =>
				fail(
					new GitSpawnError(
						`git ${args[0] ?? ""} timed out after ${Math.round(opts.timeoutMs / 1000)} s`,
						null,
						"",
						true,
					),
				),
			opts.timeoutMs,
		);
		const onAbort = () => fail(opts.signal?.reason as Error);
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		const done = () => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
		};
		child.on("error", (err) => {
			done();
			reject(failure ?? err);
		});
		child.on("close", (code) => {
			done();
			if (partial && opts.onStdoutLine) opts.onStdoutLine(partial);
			if (failure) return reject(failure);
			if (code === 0) return resolve({ stdout, stderr });
			reject(
				new GitSpawnError(
					scrubGitStderr(stderr.trim()) ||
						`git ${args[0] ?? ""} exited ${code}`,
					code,
					stderr,
					false,
				),
			);
		});
		if (opts.input !== undefined) {
			child.stdin?.on("error", () => {});
			child.stdin?.end(opts.input);
		}
	});
}

let sshConfig: {
	at: number;
	home: string | undefined;
	value: Promise<string | null>;
} | null = null;

/** `core.sshCommand`, which `GIT_SSH_COMMAND` would otherwise override; read at most every 30 s. */
function coreSshCommand(): Promise<string | null> {
	if (process.env.GIT_SSH || process.env.GIT_SSH_COMMAND)
		return Promise.resolve(null);
	const home = process.env.HOME;
	if (
		sshConfig &&
		sshConfig.home === home &&
		Date.now() - sshConfig.at < 30_000
	)
		return sshConfig.value;
	const value = spawnGit(["config", "--get", "core.sshCommand"], {
		env: gitEnv({ source: "machine", coreSshCommand: null }),
		timeoutMs: GIT_PROBE_TIMEOUT_MS,
	}).then(
		(r) => r.stdout.trim() || null,
		() => null,
	);
	sshConfig = { at: Date.now(), home, value };
	return value;
}

/** A read of the user's git config, outside any repository so a checkout's own config cannot steer it. */
export function gitConfigRead(args: string[]): Promise<GitOutput> {
	return spawnGit(args, {
		cwd: tmpdir(),
		env: gitEnv({ source: "machine", coreSshCommand: null }),
		timeoutMs: GIT_PROBE_TIMEOUT_MS,
	});
}

/** The URL git will contact: `ls-remote --get-url` expands `url.<base>.insteadOf` without contacting the remote. */
export async function effectiveGitUrl(url: string): Promise<string> {
	try {
		const { stdout } = await gitConfigRead([
			"ls-remote",
			"--get-url",
			"--",
			url,
		]);
		return stdout.trim() || url;
	} catch {
		return url;
	}
}

/** `gitEnv` for a call that may reach a remote over ssh. */
export async function remoteGitEnv(
	input: Pick<GitEnvInput, "source" | "authHeader" | "scope">,
): Promise<Record<string, string>> {
	return gitEnv({ ...input, coreSshCommand: await coreSshCommand() });
}
