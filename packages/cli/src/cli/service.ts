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
	type Action,
	buildPlan,
	renderLaunchdPlist,
	renderSystemdUnit,
	resolveLauncher,
	servicePath,
	steps,
} from "./service-unit.js";

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

function installerBinDir(config: Config): string | null {
	const receipt = safeRead(join(config.installerDataDir(), "receipt"));
	return /^bin_dir=(.+)$/m.exec(receipt)?.[1] ?? null;
}

async function waitForHealth(port: number, ms = 60_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`);
			if (res.ok) return true;
		} catch {}
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
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
		port: { type: "string", description: "Port to listen on (default 3001)" },
		host: { type: "string", description: "Host to bind (default localhost)" },
		workspace: {
			type: "string",
			description:
				"Workspace directory (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
	},
	async run({ args, cmd }) {
		assertKnownFlags(args, cmd);
		if (args.workspace)
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		const config = await loadConfig();
		const { kind, unitPath, uid } = await manager(config);
		const workspace = resolve(config.getAppDataDir());
		const port = Number(args.port ?? process.env.PRISMALENS_PORT ?? 3001);

		const existing = config.installedService();
		const lock = config.readWorkspaceLockState(workspace);
		if (
			lock.kind === "held" &&
			!config.serviceOwnsWorkspace(workspace, existing)
		) {
			consola.error(
				`pl up is running on this workspace (pid ${lock.owner.pid}, port ${lock.owner.port}). Stop it, then install the service.`,
			);
			process.exit(1);
		}
		if (existing) runAction(kind, "stop", unitPath, uid);

		const plan = buildPlan({
			launcher: resolveLauncher({
				channel: config.installChannel(),
				argv1: process.argv[1],
				installerBinDir: installerBinDir(config),
			}),
			workspace,
			port,
			host: args.host ? String(args.host) : process.env.PRISMALENS_HOST,
			path: servicePath(process.env.PATH ?? "", process.execPath),
			env: process.env,
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
		if (!(await waitForHealth(port))) {
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
		const healthy = await waitForHealth(service.port, 2000);
		consola.log(
			[
				`Unit:      ${service.unitPath}`,
				`Workspace: ${service.workspace}`,
				`Port:      ${service.port}`,
				`Running:   ${healthy ? `yes${lock.kind === "held" ? ` (pid ${lock.owner.pid})` : ""}` : "no"}`,
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
		if (!(await waitForHealth(service.port))) {
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
