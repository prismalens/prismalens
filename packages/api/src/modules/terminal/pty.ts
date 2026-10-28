// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { PRISMALENS_OWN_SECRETS } from "@prismalens/engine";

/** The slice of node-pty the terminal uses, so tests can pass a fake. */
export interface Pty {
	onData(listener: (data: string) => void): void;
	onExit(listener: (event: { exitCode: number | null }) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	pause(): void;
	resume(): void;
	kill(): void;
}

export type PtyFactory = (options: {
	file: string;
	args: string[];
	cols: number;
	rows: number;
	cwd: string;
	env: Record<string, string>;
}) => Pty;

/**
 * node-pty loads lazily: a machine where the prebuild is missing gets a
 * terminal that says "unsupported" instead of an API that fails to boot.
 */
export async function loadPtyFactory(): Promise<PtyFactory | null> {
	try {
		const pty = await import("@lydell/node-pty");
		return (o) =>
			pty.spawn(o.file, o.args, {
				name: "xterm-256color",
				cols: o.cols,
				rows: o.rows,
				cwd: o.cwd,
				env: o.env,
			}) as unknown as Pty;
	} catch {
		return null;
	}
}

/** The user's login shell, in their home folder (#931). */
export function defaultShell(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[]; cwd: string } {
	const cwd = homedir();
	if (platform === "win32") {
		const pwsh = findOnPath("pwsh.exe", env);
		return { file: pwsh ?? "powershell.exe", args: ["-NoLogo"], cwd };
	}
	const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : "/bin/sh";
	return { file: shell, args: ["-l"], cwd };
}

/** The API's environment minus PrismaLens's own secrets, as an agent gets it (ADR 0004 §3). */
export function shellEnv(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (PRISMALENS_OWN_SECRETS.prefixes.some((p) => key.startsWith(p)))
			continue;
		if ((PRISMALENS_OWN_SECRETS.names as readonly string[]).includes(key))
			continue;
		if (key === "ELECTRON_RUN_AS_NODE") continue;
		out[key] = value;
	}
	out.TERM = "xterm-256color";
	out.COLORTERM = "truecolor";
	return out;
}

function findOnPath(file: string, env: NodeJS.ProcessEnv): string | null {
	const path = env.PATH ?? env.Path ?? "";
	for (const dir of path.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, file);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
