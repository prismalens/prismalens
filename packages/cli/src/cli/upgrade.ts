// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl upgrade` — upgrade through the channel this copy came from (#717): npm,
 * the installer, Homebrew or Scoop run their own command; the desktop app gets a
 * download link. Refuses while `pl up` holds the workspace, because replacing a
 * running install's files mid-flight can crash it.
 */

import { spawnSync } from "node:child_process";
import type { InstallChannel } from "@prismalens/config";
import { defineCommand } from "citty";
import consola from "consola";
import { cliVersion } from "../version.js";
import { assertKnownFlags } from "./flags.js";
import { lockBase } from "./instance-check.js";
import { installerBinDir, lockReleased, runAction } from "./service.js";
import { fetchLatestVersion, isNewer, releaseReady } from "./update-notice.js";
import {
	awaitTrial,
	completePendingRestore,
	finish,
	readTrial,
	settleTrial,
	switchInstallerRuntime,
	type Trial,
	takeSnapshot,
} from "./upgrade-trial.js";

type Config = typeof import("@prismalens/config");

/** How `channel` puts `version` back after a failed trial; a reason when it can't (#766). */
export function switchBackFor(
	config: Config,
	channel: InstallChannel,
	version: string,
): () => string | null {
	return () => {
		if (channel === "installer") {
			const binDir = installerBinDir(config);
			if (!binDir) return "the installer's receipt has no bin_dir";
			return switchInstallerRuntime({
				dataDir: config.installerDataDir(),
				binDir,
				version,
			});
		}
		if (channel === "npm") {
			const argv = upgradeArgv("npm", version) as string[];
			consola.start(`Reinstalling ${version}: ${argv.join(" ")}`);
			const r = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
			return r.status === 0 ? null : `npm couldn't reinstall ${version}`;
		}
		return `${channel} can't reinstall ${version}; install it with the installer or npm`;
	};
}

/** argv to run for `channel`, or null when the user has to act (desktop). */
export function upgradeArgv(
	channel: InstallChannel,
	version: string,
	platform: NodeJS.Platform = process.platform,
): string[] | null {
	switch (channel) {
		case "npm":
			return platform === "win32"
				? ["cmd", "/c", "npm", "install", "-g", `prismalens@${version}`]
				: ["npm", "install", "-g", `prismalens@${version}`];
		case "installer":
			return platform === "win32"
				? [
						"powershell",
						"-NoProfile",
						"-ExecutionPolicy",
						"Bypass",
						"-Command",
						`& ([scriptblock]::Create((irm https://prismalens.io/install.ps1))) -Version ${version}`,
					]
				: [
						"sh",
						"-c",
						`curl -fsSL https://prismalens.io/install.sh | sh -s -- --version ${version}`,
					];
		case "homebrew":
			return ["brew", "upgrade", "prismalens"];
		case "scoop":
			return platform === "win32"
				? ["cmd", "/c", "scoop", "update", "prismalens"]
				: ["scoop", "update", "prismalens"];
		default:
			return null;
	}
}

export default defineCommand({
	meta: {
		name: "upgrade",
		description:
			"Upgrade PrismaLens the way it was installed (npm, installer, Homebrew or Scoop). A background service runs the new version on trial and is rolled back, database included, if it doesn't come up",
	},
	args: {
		version: {
			type: "string",
			description: "Install this version instead of the newest",
		},
		check: {
			type: "boolean",
			description: "Only say whether a newer version exists",
		},
		"trial-seconds": {
			type: "string",
			description:
				"With a background service: how long the new version has to come up before it is rolled back (default 120)",
		},
	},
	async run({ args, cmd }) {
		assertKnownFlags(args, cmd);
		const config = (await import(
			"@prismalens/config"
		)) as typeof import("@prismalens/config");
		const current = cliVersion();
		const channel = config.installChannel();

		const pinned = args.version ? String(args.version).replace(/^v/, "") : null;
		// Plain x.y.z only: the installer channel puts it into a shell command.
		if (pinned && !/^\d+\.\d+\.\d+$/.test(pinned)) {
			consola.error(
				`--version takes a plain version like 0.5.1, not "${pinned}".`,
			);
			process.exit(1);
		}
		if (pinned && (channel === "homebrew" || channel === "scoop")) {
			consola.error(
				`${channel === "homebrew" ? "Homebrew" : "Scoop"} installs only its newest version. Upgrade without --version, or use the installer for a specific one.`,
			);
			process.exit(1);
		}

		let target: string;
		if (pinned) {
			// npm resolves the version itself; the other channels need the release's archives.
			if (channel !== "npm" && !(await releaseReady(pinned))) {
				consola.error(
					`There is no PrismaLens ${pinned} release with downloads attached.`,
				);
				process.exit(1);
			}
			if (!isNewer(pinned, current)) {
				consola.error(
					pinned === current
						? `PrismaLens ${current} is already installed.`
						: `${pinned} is older than the ${current} installed. A workspace ${current} has migrated won't open in ${pinned}; see https://docs.prismalens.io/install/ before going back.`,
				);
				process.exit(1);
			}
			target = pinned;
		} else {
			const latest = await fetchLatestVersion();
			if (!latest) {
				consola.error(
					"Couldn't reach GitHub to find the newest release. Pass --version to pick one.",
				);
				process.exit(1);
			}
			if (!isNewer(latest, current)) {
				consola.success(`PrismaLens ${current} is the newest release.`);
				return;
			}
			if (channel !== "npm" && !(await releaseReady(latest))) {
				consola.info(
					`${latest} is out but its downloads are still being built. Try again in a few minutes.`,
				);
				return;
			}
			target = latest;
		}

		const command = config.upgradeCommand(
			channel,
			process.platform,
			pinned ?? undefined,
		);
		if (args.check) {
			consola.info(
				`${target} is available (you have ${current}, installed with ${channel}). Upgrade with: pl upgrade${pinned ? ` --version ${pinned}` : ""}`,
			);
			return;
		}

		const argv = upgradeArgv(channel, target);
		if (!argv) {
			consola.info(`The desktop app upgrades by download: ${command}`);
			return;
		}

		// A background service on this workspace is stopped for the upgrade and started again after (#732).
		const workspace = config.getAppDataDir();
		const service = config.installedService();
		const kind = config.serviceManagerKind();
		const uid = process.getuid?.() ?? 0;
		const viaService =
			kind !== null &&
			service !== null &&
			config.serviceOwnsWorkspace(workspace, service);
		const startService = () =>
			!viaService || runAction(kind, "start", service.unitPath, uid);
		const trialMs = Number(args["trial-seconds"] ?? 120) * 1000;
		if (!(trialMs > 0)) {
			consola.error("--trial-seconds takes a positive number.");
			process.exit(1);
		}
		const settle = async (trial: Trial) => {
			const outcome = await settleTrial({
				workspace,
				trial,
				check: () =>
					awaitTrial({
						base: lockBase(service as { host?: string; port: number }),
						instanceId: config.readInstanceFile(workspace)?.instanceId ?? "",
						version: trial.to,
						deadlineMs: trialMs,
					}),
				stop: async () => {
					if (
						!runAction(kind as "systemd", "stop", service?.unitPath ?? "", uid)
					)
						return false;
					const free = () =>
						config.readWorkspaceLockState(workspace).kind !== "held";
					await lockReleased(free);
					return free();
				},
				start: startService,
				switchBack: switchBackFor(
					config,
					trial.channel as InstallChannel,
					trial.from,
				),
			});
			if (outcome.result === "committed") return true;
			consola.error(
				outcome.result === "rolled-back"
					? `${trial.to} didn't come up (${outcome.reason}). The database is restored and ${trial.from} runs again.`
					: `${trial.to} didn't come up. The database is restored to before the upgrade, but ${outcome.reason}.`,
			);
			return false;
		};
		if (viaService) {
			if (completePendingRestore(workspace)) {
				consola.warn(
					"Finished restoring the database from an interrupted rollback.",
				);
			}
			const leftover = readTrial(workspace);
			if (leftover) {
				consola.warn(
					`An upgrade from ${leftover.from} to ${leftover.to} didn't finish; checking it first.`,
				);
				startService();
				if (!(await settle(leftover))) process.exit(1);
				consola.info(
					"That upgrade is now settled. Run pl upgrade again to continue.",
				);
				return;
			}
			consola.start("Stopping the background service for the upgrade…");
			if (!runAction(kind, "stop", service.unitPath, uid)) process.exit(1);
			await lockReleased(
				() => config.readWorkspaceLockState(workspace).kind !== "held",
			);
		}
		const lock = config.readWorkspaceLockState(workspace);
		if (lock.kind === "held") {
			consola.error(
				`pl up is running (pid ${lock.owner.pid}). Stop it first, then run pl upgrade again.`,
			);
			startService();
			process.exit(1);
		}

		// Stopped, so the copy is consistent; the new version migrates only after this (#766).
		const trial = viaService
			? takeSnapshot(workspace, {
					from: current,
					to: target,
					channel,
					startedAt: new Date().toISOString(),
				})
			: null;
		consola.start(
			`Upgrading ${current} → ${target} with ${channel}: ${argv.join(" ")}`,
		);
		const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
		if (result.status !== 0) {
			consola.error(
				`The upgrade command failed${result.error ? `: ${result.error.message}` : ""}. Run it yourself: ${command}`,
			);
			if (trial) {
				finish(workspace, {
					from: current,
					to: target,
					result: "rolled-back",
					reason: "the upgrade command failed before anything changed",
					at: new Date().toISOString(),
				});
			}
			startService();
			process.exit(result.status ?? 1);
		}
		if (trial) {
			consola.start(`Starting ${target} as a trial…`);
			startService();
			if (!(await settle(trial))) process.exit(1);
			consola.success(
				`Upgraded to ${target}; the background service is running it.`,
			);
			return;
		}
		consola.success(`Upgraded to ${target}. Start it with pl up.`);
	},
});
