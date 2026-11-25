// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The one env filter every git child goes through (#1020), from agent-host. Loaded when
 * git first runs, so the registry's other commands work before the packages are built.
 */
function gitChildEnv(
	parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const host = createRequire(import.meta.url)(
		fileURLToPath(import.meta.resolve("@prismalens/agent-host")),
	) as typeof import("@prismalens/agent-host");
	return host.gitChildEnv(parent);
}

/** `git <args>` in `cwd`, its stdout as text. */
export function git(
	args: readonly string[],
	opts: Omit<ExecFileSyncOptions, "env" | "encoding"> = {},
): string {
	return execFileSync("git", args, {
		windowsHide: true,
		...opts,
		encoding: "utf8",
		env: gitChildEnv(process.env),
	}) as string;
}

/**
 * Where `dir` sits in its repository: `prefix` from the root (no trailing slash), `toRoot` back up.
 * Git answers both, as a linked `dir` (macOS's /var) is not under the root's real path.
 */
export function repoPaths(dir: string): { prefix: string; toRoot: string } {
	const ask = (flag: string) =>
		git(["rev-parse", flag], { cwd: dir }).trim().replace(/\/$/, "");
	return { prefix: ask("--show-prefix"), toRoot: ask("--show-cdup") };
}
