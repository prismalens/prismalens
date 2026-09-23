// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A GUI-launched app on macOS or Linux inherits a minimal PATH and no shell
 * rc, so `git`, `claude` and every harness the user installed through their
 * shell are invisible to it. Ask the login shell what PATH it would give an
 * interactive session, the way t3code does, and hand that to the backend.
 */

import { execFile } from "node:child_process";

// An interactive shell may print a banner or rc output around the PATH.
const START = "__PRISMALENS_PATH_START__";
const END = "__PRISMALENS_PATH_END__";

export function readLoginShellPath(
	env: NodeJS.ProcessEnv = process.env,
	timeoutMs = 5_000,
): Promise<string | undefined> {
	if (process.platform === "win32") return Promise.resolve(undefined);
	const shell = env.SHELL || "/bin/sh";
	return new Promise((resolve) => {
		execFile(
			shell,
			["-ilc", `printf "%s%s%s" "${START}" "$PATH" "${END}"`],
			{ timeout: timeoutMs, env },
			(error, stdout) => {
				if (error) return resolve(undefined);
				const start = stdout.indexOf(START);
				const end = stdout.indexOf(END, start + START.length);
				if (start === -1 || end === -1) return resolve(undefined);
				const path = stdout.slice(start + START.length, end).trim();
				resolve(path || undefined);
			},
		);
	});
}
