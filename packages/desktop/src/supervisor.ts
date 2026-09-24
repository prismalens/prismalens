// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What the launcher decides before it touches a process: attach to a backend
 * that already holds the workspace, or spawn one. Pure, so it is testable
 * without Electron. The backend is the packed `prismalens` package, run under
 * this Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`), which is what makes
 * the app self-contained.
 */

import { createServer } from "node:net";
import type { WorkspaceLockState } from "@prismalens/config";

export type LaunchPlan =
	| { kind: "attach"; port: number; pid: number }
	| { kind: "spawn"; port: number };

/**
 * A live backend on the workspace is attached to, never duplicated (ADR 0005
 * §8: the lock carries pid and port so a second launcher attaches). Anything
 * else spawns on the requested port.
 */
export function planLaunch(lock: WorkspaceLockState, port: number): LaunchPlan {
	if (lock.kind === "held") {
		return { kind: "attach", port: lock.owner.port, pid: lock.owner.pid };
	}
	return { kind: "spawn", port };
}

export interface BackendSpawn {
	/** The Electron binary, run as Node. */
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
}

/**
 * The child is `pl up` on a loopback port. It opens no browser: the window is this app's, and it pairs itself (`session.ts`).
 */
export function backendSpawn(input: {
	execPath: string;
	backendMain: string;
	port: number;
	workspaceDir?: string;
	env: NodeJS.ProcessEnv;
	loginShellPath?: string;
}): BackendSpawn {
	const args = [
		input.backendMain,
		"up",
		"--port",
		String(input.port),
		"--host",
		"127.0.0.1",
		"--no-open",
	];
	if (input.workspaceDir) args.push("--workspace", input.workspaceDir);
	const env: NodeJS.ProcessEnv = {
		...input.env,
		ELECTRON_RUN_AS_NODE: "1",
		PRISMALENS_RUN_MODE: "electron",
		// A GUI-launched app inherits no shell rc; the harness must still resolve.
		...(input.loginShellPath ? { PATH: input.loginShellPath } : {}),
	};
	return { command: input.execPath, args, env };
}

/**
 * `pl pair --operator` on the workspace, run the same way as the backend: the
 * link it prints is the window's way in (ADR 0004 §8).
 */
export function pairOperatorSpawn(input: {
	execPath: string;
	backendMain: string;
	workspaceDir: string;
	env: NodeJS.ProcessEnv;
}): BackendSpawn {
	return {
		command: input.execPath,
		args: [
			input.backendMain,
			"pair",
			"--operator",
			"--workspace",
			input.workspaceDir,
		],
		env: { ...input.env, ELECTRON_RUN_AS_NODE: "1" },
	};
}

/**
 * `pl reset --yes` for the launcher's workspace. The launcher asks first in its
 * own dialog, and runs this only after its backend has exited (the command
 * says "Stop `pl up` first"); `pl reset` itself refuses a directory that is
 * not a workspace.
 */
export function resetWorkspaceSpawn(input: {
	execPath: string;
	backendMain: string;
	workspaceDir: string;
	env: NodeJS.ProcessEnv;
}): BackendSpawn {
	return {
		command: input.execPath,
		args: [
			input.backendMain,
			"reset",
			"--yes",
			"--workspace",
			input.workspaceDir,
		],
		env: { ...input.env, ELECTRON_RUN_AS_NODE: "1" },
	};
}

/** A free loopback port, asked of the OS. */
export function pickFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => (port ? resolve(port) : reject(new Error("no port"))));
		});
	});
}

export function backendUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}
