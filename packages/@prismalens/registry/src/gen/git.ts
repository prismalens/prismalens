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
