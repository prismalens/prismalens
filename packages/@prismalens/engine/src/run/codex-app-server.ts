// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One `codex app-server` with `-c` overrides, such as the check isolation's switches (#1180 R1).
 * No thread is started on it, so no hook runs.
 */
import { createInterface } from "node:readline";
import {
	codexConfigArgs,
	killProcessTree,
	spawnAgent,
} from "@prismalens/agent-host";

const CLIENT_VERSION = "1";

type Rpc = { id?: number; result?: unknown; error?: unknown };

export interface CodexAppServerPlan {
	command: string;
	/** Arguments before the CLI's own, for a CLI started through another program. */
	args?: readonly string[];
	env: Record<string, string>;
	cwd: string;
}

export function codexAppServerArgs(mcp: readonly string[]): string[] {
	return ["app-server", ...codexConfigArgs(mcp)];
}

/**
 * `work` against an initialized app-server; null when the CLI exits, a call fails, or
 * `budgetMs` passes. The process is killed either way.
 */
export async function withCodexAppServer<T>(
	plan: CodexAppServerPlan,
	/** `-c` overrides after `app-server`; `codexConfigArgs(mcp)` for a check. */
	overrides: readonly string[],
	budgetMs: number,
	work: (
		call: (method: string, params: unknown) => Promise<unknown>,
	) => Promise<T>,
): Promise<T | null> {
	const child = spawnAgent({
		command: plan.command,
		args: [...(plan.args ?? []), "app-server", ...overrides],
		cwd: plan.cwd,
		env: plan.env,
	});
	const pending = new Map<number, (msg: Rpc) => void>();
	let next = 0;
	child.stdin.on("error", () => {});
	createInterface({ input: child.stdout }).on("line", (line) => {
		try {
			const msg = JSON.parse(line) as Rpc;
			if (typeof msg.id === "number") pending.get(msg.id)?.(msg);
		} catch {
			// A log line on stdout is not an answer.
		}
	});
	child.stderr.resume();
	const exited = new Promise<null>((resolve) => {
		child.once("error", () => resolve(null));
		child.once("exit", () => resolve(null));
	});
	const call = (method: string, params: unknown) =>
		new Promise<unknown>((resolve, reject) => {
			const id = ++next;
			pending.set(id, (msg) => {
				pending.delete(id);
				if (msg.error !== undefined)
					reject(new Error(JSON.stringify(msg.error)));
				else resolve(msg.result);
			});
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	const run = async () => {
		await call("initialize", {
			clientInfo: { name: "prismalens", version: CLIENT_VERSION },
		});
		child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
		return work(call);
	};
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), budgetMs);
	});
	try {
		return await Promise.race([run().catch(() => null), exited, late]);
	} finally {
		clearTimeout(timer);
		killProcessTree(child);
		// Windows keeps the folder locked until the process is gone.
		await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))]);
	}
}
