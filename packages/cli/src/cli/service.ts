// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl service` — run PrismaLens as a background service for this user (#732): a
 * systemd user unit on Linux, a launchd agent on macOS. The service runs
 * `pl up --no-open`, so it holds the workspace lock like any `pl up`.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import consola from "consola";
import { assertKnownFlags } from "./flags.js";
import {
	checkIdentity,
	describeOutcome,
	type IdentityOutcome,
	lockBase,
} from "./instance-check.js";
import {
	type Action,
	activeProbe,
	buildPlan,
	renderLaunchdPlist,
	renderSystemdUnit,
	resolveLauncher,
	servicePath,
	steps,
} from "./service-unit.js";
import { healthUrl, waitForReady } from "./up-console.js";
import { fetchInstance, type Outcome, readOutcome } from "./upgrade-trial.js";

type Config = typeof import("@prismalens/config");

const loadConfig = () => import("@prismalens/config") as Promise<Config>;

function exec(argv: string[]): { ok: boolean; out: string } {
	const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
	return {
		ok: result.status === 0,
		out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
	};
}

/** The manager for this OS, or an exit with the reason there is none. */
async function manager(config: Config) {
	const kind = config.serviceManagerKind();
	if (!kind) {
		consola.error(
			"A background service isn't supported on Windows. Use the desktop app and turn on Start at login in its tray menu.",
		);
		process.exit(1);
	}
	if (
		kind === "systemd" &&
		!exec(["systemctl", "--user", "show-environment"]).ok
	) {
		const wsl = /microsoft/i.test(safeRead("/proc/version"));
		consola.error(
			wsl
				? "WSL isn't running systemd. Add `[boot]` and `systemd=true` to /etc/wsl.conf, run `wsl --shutdown` from Windows, then try again."
				: "Can't reach the systemd user manager (`systemctl --user`). Run this from a login session as your own user, not with sudo.",
		);
		process.exit(1);
	}
	const unitPath = config.serviceUnitPath() as string;
	return { kind, unitPath, uid: process.getuid?.() ?? 0 };
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** Runs one action's steps; false when a required step failed. */
export function runAction(
	kind: ReturnType<Config["serviceManagerKind"]> & string,
	action: Action,
	unitPath: string,
	uid: number,
): boolean {
	for (const step of steps(kind, action, unitPath, uid)) {
		const result = exec(step.argv);
		if (!result.ok && !step.optional) {
			consola.error(
				`\`${step.argv.join(" ")}\` failed${result.out ? `: ${result.out}` : ""}`,
			);
			return false;
		}
	}
	return true;
}

/** True when the service is in a failed or exited state. */
export function serviceFailed(
	kind: ReturnType<Config["serviceManagerKind"]> & string,
	uid: number,
	execImpl = exec,
): boolean {
	if (kind === "systemd") {
		return execImpl([
			"systemctl",
			"--user",
			"is-failed",
			"--quiet",
			"prismalens.service",
		]).ok;
	}
	if (kind === "launchd") {
		const out = execImpl([
			"launchctl",
			"print",
			`gui/${uid}/io.prismalens.server`,
		]);
		if (!out.ok) return true;
		const match = /last exit (?:status|code) = ([0-9]+)/.exec(out.out);
		return Boolean(match && match[1] !== "0");
	}
	return false;
}

export function installerBinDir(config: Config): string | null {
	const receipt = safeRead(join(config.installerDataDir(), "receipt"));
	return /^bin_dir=(.+)$/m.exec(receipt)?.[1] ?? null;
}

function waitForHealth(
	bind: { host?: string; port: number },
	timeoutMs = 60_000,
): Promise<boolean> {
	const url = healthUrl({
		host: bind.host || "127.0.0.1",
		port: bind.port,
		protocol: "http",
	});
	return waitForReady(url, { timeoutMs, intervalMs: 500 });
}

/** Waits until `free()` or the deadline; the stopped unit's pl up needs a moment to drop the lock. */
export async function lockReleased(
	free: () => boolean,
	ms = 30_000,
): Promise<void> {
	const deadline = Date.now() + ms;
	while (!free() && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
	}
}

function lingerHint(): string | null {
	if (process.platform !== "linux") return null;
	const linger = exec([
		"loginctl",
		"show-user",
		String(process.getuid?.() ?? ""),
		"--property=Linger",
		"--value",
	]);
	if (linger.ok && linger.out === "yes") return null;
	return 'Lingering is off, so the service stops when you log out and doesn\'t start at boot. Turn it on with: sudo loginctl enable-linger "$(id -un)"';
}

const install = defineCommand({
	meta: {
		name: "install",
		description: "Install and start the background service",
	},
	args: {
		port: {
			type: "string",
			description: "Port to listen on (default: the workspace's port)",
		},
		host: { type: "string", description: "Host to bind (default 127.0.0.1)" },
		"tailscale-serve": {
			type: "boolean",
			description:
				"Publish the service on your tailnet over HTTPS with `tailscale serve`, on every start",
		},
		workspace: {
			type: "string",
			description:
				"Workspace directory (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
	},
	async run({ args, cmd }) {
		assertKnownFlags(args, cmd);
		const explicitPort = args.port ?? process.env.PRISMALENS_PORT;
		const rawPort = String(explicitPort ?? "");
		if (
			explicitPort !== undefined &&
			(!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
		) {
			consola.error(
				`--port must be a number from 1 to 65535, not "${rawPort}".`,
			);
			process.exit(1);
		}
		if (args.workspace)
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		const config = await loadConfig();
		const { kind, unitPath, uid } = await manager(config);
		const workspace = resolve(config.getAppDataDir());
		const port =
			explicitPort !== undefined
				? Number(rawPort)
				: config.ensureInstanceFile(workspace).port;
		const host =
			(args.host ? String(args.host) : process.env.PRISMALENS_HOST) ||
			undefined;

		// Refuse before stopping anything; when the unit is ours, stop it first so a
		// lock still held afterwards is a foreground pl up (#735 review).
		const existing = config.installedService();
		const ours = config.serviceOwnsWorkspace(workspace, existing);
		const refuseIfHeld = (restart: boolean) => {
			const lock = config.readWorkspaceLockState(workspace);
			if (lock.kind !== "held") return;
			consola.error(
				`pl up is running on this workspace (pid ${lock.owner.pid}, port ${lock.owner.port}). Stop it, then install the service.`,
			);
			if (restart) runAction(kind, "start", unitPath, uid);
			process.exit(1);
		};
		if (!ours) refuseIfHeld(false);
		// Only a unit that was running before this install is started again on refusal.
		const wasActive = existing !== null && exec(activeProbe(kind, uid)).ok;
		if (existing) runAction(kind, "stop", unitPath, uid);
		if (ours) {
			await lockReleased(
				() => config.readWorkspaceLockState(workspace).kind !== "held",
			);
			refuseIfHeld(wasActive);
		}

		const plan = buildPlan({
			launcher: resolveLauncher({
				channel: config.installChannel(),
				argv1: process.argv[1],
				installerBinDir: installerBinDir(config),
			}),
			workspace,
			port,
			host,
			path: servicePath(process.env.PATH ?? "", process.execPath),
			env: process.env,
			tailscaleServe: Boolean(args["tailscale-serve"]),
		});
		mkdirSync(dirname(unitPath), { recursive: true });
		mkdirSync(dirname(plan.logPath), { recursive: true });
		writeFileSync(
			unitPath,
			kind === "systemd"
				? renderSystemdUnit(plan)
				: renderLaunchdPlist(plan, homedir()),
		);
		if (!runAction(kind, "start", unitPath, uid)) process.exit(1);

		consola.start(`Starting PrismaLens on port ${port}…`);
		if (!(await waitForHealth({ host, port }))) {
			consola.error(
				`The service didn't answer on port ${port} within a minute. Its log: ${plan.logPath}`,
			);
			process.exit(1);
		}
		consola.success(
			`PrismaLens runs in the background on http://localhost:${port}, and starts again when you log in.`,
		);
		await printOperatorLink(workspace, port);
		const hint = lingerHint();
		if (hint) consola.warn(hint);
	},
});

async function printOperatorLink(
	workspace: string,
	port: number,
): Promise<void> {
	const {
		buildPairingUrl,
		createPairingLinkInWorkspace,
		OPERATOR_SCOPES,
		STARTUP_LINK_LABEL,
	} = await import("@prismalens/auth");
	const link = await createPairingLinkInWorkspace(workspace, {
		label: STARTUP_LINK_LABEL,
		scopes: OPERATOR_SCOPES,
	});
	consola.info(
		`Open this in this machine's browser within 15 minutes (it works once):\n\n  ${buildPairingUrl(`http://localhost:${port}`, link.token)}\n\nLater, \`pl pair --operator\` prints another.`,
	);
}

function safeInstanceId(config: Config, workspace: string): string {
	try {
		return config.readInstanceFile(workspace)?.instanceId ?? "";
	} catch {
		return "";
	}
}

export function runningLine(
	identity: IdentityOutcome,
	base: string,
	pid: number | null,
): string {
	if (identity.kind === "ok") return `yes (pid ${pid})`;
	if (identity.kind === "not-running") return "no";
	return `no: ${describeOutcome(identity, base).trim()}`;
}

/** The last `pl upgrade`'s outcome, for `pl service status` (#766). */
export function upgradeLine(o: Outcome): string {
	const when = o.at.slice(0, 16).replace("T", " ");
	if (o.result === "committed") return `${o.from} → ${o.to} on ${when}`;
	const what =
		o.result === "rolled-back"
			? `rolled back to ${o.from}`
			: "database restored";
	return `${o.from} → ${o.to} ${what} on ${when}: ${o.reason ?? "no reason recorded"}`;
}

const status = defineCommand({
	meta: {
		name: "status",
		description: "Show whether the background service is installed and running",
	},
	async run() {
		const config = await loadConfig();
		const kind = config.serviceManagerKind();
		const service = config.installedService();
		if (!kind || !service) {
			consola.info(
				"No background service is installed. Install one with: pl service install",
			);
			return;
		}
		const lock = config.readWorkspaceLockState(service.workspace);
		const base = lockBase(
			lock.kind === "held"
				? lock.owner
				: { host: service.host, port: service.port },
		);
		const identity = await checkIdentity({
			pid: lock.kind === "held" ? lock.owner.pid : null,
			base,
			instanceId: safeInstanceId(config, service.workspace),
		});
		const healthy = identity.kind === "ok";
		const info = healthy ? await fetchInstance(base) : null;
		const outcome = readOutcome(service.workspace);
		consola.log(
			[
				`Unit:      ${service.unitPath}`,
				`Workspace: ${service.workspace}`,
				`Port:      ${service.port}`,
				`Running:   ${runningLine(identity, base, lock.kind === "held" ? lock.owner.pid : null)}`,
				...(info && typeof info !== "string"
					? [`Version:   ${info.version ?? "unknown"}`]
					: []),
				...(outcome ? [`Upgrade:   ${upgradeLine(outcome)}`] : []),
				`Log:       ${join(service.workspace, "logs", "service.log")}`,
			].join("\n"),
		);
		const hint = lingerHint();
		if (hint) consola.warn(hint);
		if (!healthy) process.exitCode = 1;
	},
});

const restart = defineCommand({
	meta: { name: "restart", description: "Restart the background service" },
	async run() {
		const config = await loadConfig();
		const { kind, unitPath, uid } = await manager(config);
		const service = config.installedService();
		if (!service) {
			consola.error("No background service is installed.");
			process.exit(1);
		}
		if (!runAction(kind, "restart", unitPath, uid)) process.exit(1);
		if (!(await waitForHealth(service))) {
			consola.error(
				`The service didn't come back on port ${service.port}. Its log: ${join(service.workspace, "logs", "service.log")}`,
			);
			process.exit(1);
		}
		consola.success("Restarted.");
	},
});

const uninstall = defineCommand({
	meta: {
		name: "uninstall",
		description:
			"Stop the background service and remove it; the workspace stays",
	},
	async run() {
		const config = await loadConfig();
		const { kind, unitPath, uid } = await manager(config);
		if (!existsSync(unitPath)) {
			consola.info("No background service is installed.");
			return;
		}
		runAction(kind, "remove", unitPath, uid);
		rmSync(unitPath, { force: true });
		if (kind === "systemd") exec(["systemctl", "--user", "daemon-reload"]);
		consola.success(
			"The background service is removed. Your workspace and its data are kept.",
		);
	},
});

export default defineCommand({
	meta: {
		name: "service",
		description:
			"Run PrismaLens in the background for this user (systemd on Linux, launchd on macOS)",
	},
	subCommands: { install, status, restart, uninstall },
});
