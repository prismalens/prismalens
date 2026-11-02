// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `pl --version` on a Windows `.cmd` shim: Node cannot spawn one without cmd.exe (#634). */
import { resolveOnPath } from "@prismalens/config/harness-selection";

/** `.cmd`/`.bat` — the npm shim extensions Node's own spawn cannot exec directly on Windows. */
const CMD_SHIM_RE = /\.(cmd|bat)$/i;

// Exact port of escapeCommand and escapeArgument from cross-spawn 7.0.6 (node_modules/cross-spawn/lib/util/escape.js).
// See http://www.robvanderwoude.com/escapechars.php
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Escape a command for a `cmd.exe /d /s /c "<line>"` invocation.
 * Exact port from cross-spawn 7.0.6 `lib/util/escape.js`.
 */
export function escapeCommand(arg: string): string {
	return arg.replace(META_CHARS_RE, "^$1");
}

/**
 * Escape one argument token for a `cmd.exe /d /s /c "<whole line>"` invocation.
 * Exact port from cross-spawn 7.0.6 `lib/util/escape.js`.
 *
 * Algorithm is based on https://qntm.org/cmd, slightly altered in cross-spawn
 * (PR #160) to avoid catastrophic backtracking. Quotes the whole argument,
 * doubles up backslashes before double-quotes and at the end of string, and
 * escapes metacharacters with `^` (twice if doubleEscapeMetaChars is true for .cmd/.bat shims).
 */
export function escapeArgument(
	arg: string,
	doubleEscapeMetaChars = true,
): string {
	let str = `${arg}`;

	// Sequence of backslashes followed by a double quote:
	// double up all the backslashes and escape the double quote
	str = str.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');

	// Sequence of backslashes followed by the end of the string
	// (which will become a double quote later):
	// double up all the backslashes
	str = str.replace(/(?=(\\+?)?)\1$/, "$1$1");

	// All other backslashes occur literally

	// Quote the whole thing:
	str = `"${str}"`;

	// Escape meta chars
	str = str.replace(META_CHARS_RE, "^$1");

	// Double escape meta chars if necessary
	if (doubleEscapeMetaChars) {
		str = str.replace(META_CHARS_RE, "^$1");
	}

	return str;
}

/**
 * Windows cannot `execve` a `.cmd`/`.bat` shim directly (Node's own spawn throws
 * `EINVAL` — the file has no PE header, only `cmd.exe` knows how to run it), which
 * is exactly what an npm-installed harness binary is on that platform. On `win32`,
 * when `command` itself ends `.cmd`/`.bat` or the copy `resolveOnPath` would find
 * does, this re-plans the spawn as `cmd.exe /d /s /c "<quoted command + args>"`
 * (`/d` skips AutoRun registry commands, `/s` keeps the quoting below literal) with
 * `windowsVerbatimArguments: true` so Node does not re-escape what is already a
 * hand-built cmd.exe command line. `shell: true` is never used — it is the
 * injection surface CVE-2024-27980 closed, and this plan is the escaped
 * alternative. Every other platform, and every non-shim command, is unchanged.
 */
export function windowsSpawnPlan(
	command: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
): {
	command: string;
	args: string[];
	options: { windowsVerbatimArguments?: boolean };
} {
	if (platform !== "win32") return { command, args, options: {} };
	const resolved = resolveOnPath(command);
	// A bare name goes to cmd.exe as its resolved path, so cmd.exe's own lookup cannot pick another file.
	const target = CMD_SHIM_RE.test(command) ? command : resolved;
	if (target === null || !CMD_SHIM_RE.test(target))
		return { command, args, options: {} };
	const comSpec = process.env.ComSpec ?? "cmd.exe";
	const escapedCmd = escapeCommand(target);
	const escapedArgs = args.map((arg) => escapeArgument(arg, true));
	const line = [escapedCmd, ...escapedArgs].join(" ");
	return {
		command: comSpec,
		args: ["/d", "/s", "/c", `"${line}"`],
		options: { windowsVerbatimArguments: true },
	};
}
