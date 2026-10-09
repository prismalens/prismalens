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
import type { InstalledService, WorkspaceLockState } from "@prismalens/config";

/** Where a backend answers. */
export interface Target {
	protocol: "http" | "https";
	host: string;
	port: number;
}

export type LaunchPlan =
	| { kind: "attach"; target: Target; pid: number }
	| { kind: "service"; target: Target }
	| { kind: "spawn"; target: Target };

/** A wildcard or missing bind is reached over loopback. */
export function reachableHost(host: string | undefined): string {
	return !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

/**
 * Attach to the live owner at its real bind (ADR 0005 §8); else start, never
 * enable, a service that owns the workspace; else spawn on the workspace's own
 * port, never a random one, so its address and cookies stay put (#763).
 */
export function planLaunch(input: {
	lock: WorkspaceLockState;
	service: InstalledService | null;
	ownsWorkspace: boolean;
	storedPort: number;
	protocol: "http" | "https";
}): LaunchPlan {
	const { lock, service, protocol } = input;
	if (lock.kind === "held") {
		return {
			kind: "attach",
			pid: lock.owner.pid,
			target: {
				protocol,
				host: reachableHost(lock.owner.host),
				port: lock.owner.port,
			},
		};
	}
	if (service && input.ownsWorkspace) {
		return {
			kind: "service",
			target: {
				protocol,
				host: reachableHost(service.host),
				port: service.port,
			},
		};
	}
	return {
		kind: "spawn",
		target: { protocol, host: "127.0.0.1", port: input.storedPort },
	};
}

/** Start an installed service that is stopped: start only, never enable. */
export function serviceStartCommands(
	kind: "systemd" | "launchd",
	unitPath: string,
	uid: number,
): { argv: string[]; optional?: boolean }[] {
	if (kind === "systemd") {
		return [{ argv: ["systemctl", "--user", "start", "prismalens.service"] }];
	}
	const domain = `gui/${uid}`;
	return [
		// Already loaded is fine; kickstart below is what starts it.
		{ argv: ["launchctl", "bootstrap", domain, unitPath], optional: true },
		{ argv: ["launchctl", "kickstart", `${domain}/io.prismalens.server`] },
	];
}

/** What the launcher tells the operator when it cannot carry on silently. */
export interface StopDialog {
	kind:
		| "newer-database"
		| "crashed"
		| "attached-gone"
		| "older-backend"
		| "port-taken"
		| "port-taken-wsl";
	message: string;
	detail: string;
	buttons: string[];
	/** A free port the "Start on port" button starts this workspace on (#673 w50). */
	freePort?: number;
}

/** A refusal that offers a way on (Start on port N, Use the one in WSL) is not an error (#673 walk 4). */
export function refusalIcon(d: StopDialog): "info" | "error" {
	return d.buttons.length > 1 ? "info" : "error";
}

const NEWER_DATABASE = /written by a newer PrismaLens/i;

/** The dialog for a backend that stopped: one this app owned, or one it attached to. */
export function stopDialog(input: {
	owned: boolean;
	code: number | null;
	stderrTail: string[];
}): StopDialog {
	if (!input.owned) {
		return {
			kind: "attached-gone",
			message: "PrismaLens stopped",
			detail:
				"The PrismaLens this window was using is no longer running. Start it here, in this app, or quit.",
			buttons: ["Start it here", "Quit"],
		};
	}
	const newer = input.stderrTail.find((line) => NEWER_DATABASE.test(line));
	if (newer) {
		return {
			kind: "newer-database",
			message: "This workspace needs a newer PrismaLens",
			detail: newer.trim(),
			buttons: ["Download update", "Quit"],
		};
	}
	const tail = input.stderrTail.map(withoutLogFields).join("\n").trim();
	return {
		kind: "crashed",
		message: `PrismaLens stopped (exit code ${input.code ?? "none"})`,
		detail: tail || "It printed nothing to stderr.",
		buttons: ["Restart", "Quit"],
	};
}

export const OLDER_BACKEND_DIALOG: StopDialog = {
	kind: "older-backend",
	message: "This PrismaLens is older than the app; update it.",
	detail:
		"It does not answer /api/instance, so the app cannot tell which workspace it is.",
	buttons: ["Quit"],
};

/**
 * The workspace's port is held by something that is not this workspace's
 * backend: start on a free port this time, or quit. Never a raw instance id.
 */
export function portTakenDialog(input: {
	port: number;
	/** Whether the holder answered `/api/instance`, i.e. is another PrismaLens. */
	byPrismaLens: boolean;
	freePort: number | null;
	instanceFile: string;
}): StopDialog {
	const holder = input.byPrismaLens ? "another PrismaLens" : "another program";
	const forGood = `To move this workspace for good, change "port" in ${input.instanceFile}.`;
	return {
		kind: "port-taken",
		message: `Port ${input.port} is in use by ${holder}`,
		detail: input.freePort
			? `Start this workspace on port ${input.freePort} this time, or stop what is listening on ${input.port} and relaunch. ${forGood}`
			: `Stop what is listening on ${input.port} and relaunch. ${forGood}`,
		buttons: input.freePort
			? [`Start on port ${input.freePort}`, "Quit"]
			: ["Quit"],
		...(input.freePort ? { freePort: input.freePort } : {}),
	};
}

/** The first free loopback port after `from`, or null after `tries` ports. */
export async function nextFreePort(
	from: number,
	isFree: (port: number) => Promise<boolean> = portFree,
	tries = 20,
): Promise<number | null> {
	for (let port = from + 1; port <= Math.min(from + tries, 65535); port++) {
		if (await isFree(port)) return port;
	}
	return null;
}

const LOG_LEVEL = /^(ERROR|WARN|FATAL|INFO):\s+/;

/**
 * A logger line ends with its record's fields as JSON, after its level word;
 * a dialog shows only the sentence (#673 w50).
 */
export function withoutLogFields(line: string): string {
	const text = line.replace(LOG_LEVEL, "");
	const open = ' {"';
	for (let at = text.indexOf(open); at >= 0; at = text.indexOf(open, at + 1)) {
		try {
			const record: unknown = JSON.parse(text.slice(at + 1));
			// Only the logger's record (service/context); JSON inside a message stays.
			if (
				record &&
				typeof record === "object" &&
				("service" in record || "context" in record)
			)
				return text.slice(0, at).trimEnd();
		} catch {
			// A brace inside the message, not the record's tail.
		}
	}
	return text;
}

/** Keep the last `max` stderr lines across chunk boundaries. */
export function appendTail(tail: string[], chunk: string, max = 20): string[] {
	const lines = chunk.split(/\r?\n/).filter((l) => l.trim() !== "");
	return [...tail, ...lines].slice(-max);
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

/** Whether a loopback port can be bound right now. */
export function portFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

export function backendUrl(target: Target): string {
	const host = target.host.includes(":") ? `[${target.host}]` : target.host;
	return `${target.protocol}://${host}:${target.port}`;
}
