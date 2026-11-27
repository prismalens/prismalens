// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl upgrade` — upgrade through the channel this copy came from (#717): npm,
 * the installer, Homebrew or Scoop run their own command; the desktop app gets a
 * download link. Refuses while `pl up` holds the workspace, because replacing a
 * running install's files mid-flight can crash it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type InstallChannel,
	isExactVersion,
	NIGHTLY_NPM_ONLY,
	type UpdateChannel,
} from "@prismalens/config";
import { defineCommand } from "citty";
import consola from "consola";
import { cliVersion } from "../version.js";
import { assertKnownFlags } from "./flags.js";
import { lockBase } from "./instance-check.js";
import {
	installerBinDir,
	lockReleased,
	runAction,
	serviceFailed,
} from "./service.js";
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

/**
 * The env an upgrade command runs in. On Windows it drops PSModulePath: a PowerShell 7 terminal's
 * value reaches the Windows PowerShell that the installer and Scoop run, which then can't load its
 * own Get-FileHash. Each PowerShell rebuilds its default when the variable is unset (#965).
 */
export function upgradeEnv(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
	if (platform !== "win32") return env;
	return Object.fromEntries(
		Object.entries(env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
	);
}

/** What npm's launcher told the runtime it started (#717); null outside the launcher. */
export interface LauncherInfo {
	node: string;
	launcher: string;
	version: string;
}

export function launcherInfo(env: NodeJS.ProcessEnv): LauncherInfo | null {
	const {
		PRISMALENS_LAUNCHER: launcher,
		PRISMALENS_LAUNCHER_NODE: node,
		PRISMALENS_LAUNCHER_VERSION: version,
	} = env;
	return launcher && node && version ? { launcher, node, version } : null;
}

const npmInstall = (version: string, platform: NodeJS.Platform) =>
	upgradeArgv("npm", version, platform) as string[];

/**
 * The commands that move a launcher install to `target`, and those that undo them when one fails.
 * Each switch downloads and verifies before the launcher flips its pointer, and refuses a
 * runtime older than the workspace database, so a failed step leaves the pointer as it was.
 */
export function launcherSteps(
	info: LauncherInfo,
	target: string,
	workspace: string,
	platform: NodeJS.Platform = process.platform,
): { steps: string[][]; undo: string[][] } {
	const launcher = (...args: string[]) => [
		info.node,
		info.launcher,
		"--launcher-switch",
		...args,
		"--workspace",
		workspace,
	];
	// The target decides, not the channel: a stable release can overtake the newest nightly.
	if (isNightlyVersion(target))
		return { steps: [launcher("nightly", "--version", target)], undo: [] };
	// A stable runtime is the launcher's own version, so any other stable comes from npm.
	if (target === info.version) return { steps: [launcher("stable")], undo: [] };
	return {
		steps: [npmInstall(target, platform), launcher("stable")],
		undo: [npmInstall(info.version, platform)],
	};
}

const isNightlyVersion = (version: string) => version.includes("-nightly.");

/**
 * The steps that put back the runtime a failed trial started from: the one the trial
 * recorded, never the launcher's shared `previous`, which another workspace may have moved.
 */
export function rollbackSteps(
	info: LauncherInfo,
	trial: Trial,
	workspace: string,
	platform: NodeJS.Platform = process.platform,
): string[][] {
	const launcher = (...args: string[]) => [
		info.node,
		info.launcher,
		"--launcher-switch",
		...args,
		"--workspace",
		workspace,
	];
	const from = trial.runtime;
	// 0.5.1-0.5.5 record no runtime: they ran from npm's own package, not a launcher, so
	// putting that version back is an npm install; the launcher's previous never held it.
	if (!from) return [npmInstall(trial.from, platform)];
	// Only a stable target changed npm's launcher. A stable runtime is its launcher's own
	// version, so a recorded stable (also a pruned nightly's fallback) needs that launcher back.
	const now = isNightlyVersion(trial.to) ? from.launcher : trial.to;
	const wanted = from.channel === "stable" ? from.version : from.launcher;
	const reinstall = now !== wanted ? [npmInstall(wanted, platform)] : [];
	return [
		...reinstall,
		from.channel === "nightly"
			? launcher("nightly", "--version", from.version)
			: launcher("stable"),
	];
}

/** Long enough for a slow download of a ~90 MB archive, short enough that a hang ends. */
export const STEP_TIMEOUT_MS = 20 * 60 * 1000;

type Spawn = (argv: string[]) => {
	status: number | null;
	error?: Error;
	signal?: string | null;
};

const spawnStep: Spawn = (argv) =>
	spawnSync(argv[0], argv.slice(1), {
		windowsHide: true,
		stdio: "inherit",
		env: upgradeEnv(),
		timeout: STEP_TIMEOUT_MS,
	});

/** Runs `steps` in order; on a failure runs `undo` and says which step failed and why. */
export function runSteps(
	steps: string[][],
	undo: string[][],
	spawn: Spawn = spawnStep,
): { ok: true } | { ok: false; failed: string; undone: boolean } {
	for (const argv of steps) {
		const r = spawn(argv);
		if (r.status === 0) continue;
		const why = r.error
			? r.error.message
			: r.signal
				? `ended by ${r.signal}`
				: `exited ${r.status}`;
		const undone = undo.every((u) => spawn(u).status === 0);
		return { ok: false, failed: `${argv.join(" ")} (${why})`, undone };
	}
	return { ok: true };
}

/** How `channel` puts `version` back after a failed trial; a reason when it can't (#766). */
export function switchBackFor(
	config: Config,
	trial: Trial,
): () => string | null {
	const channel = trial.channel as InstallChannel;
	const version = trial.from;
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
		const info = channel === "npm" ? launcherInfo(process.env) : null;
		if (info) {
			// The database is restored by now, so the launcher's migration check passes.
			const workspace =
				config.installedService()?.workspace ?? config.getAppDataDir();
			const r = runSteps(rollbackSteps(info, trial, workspace), []);
			return r.ok ? null : `couldn't switch back to ${version}: ${r.failed}`;
		}
		if (channel === "npm") {
			const argv = upgradeArgv("npm", version) as string[];
			consola.start(`Reinstalling ${version}: ${argv.join(" ")}`);
			const r = spawnSync(argv[0], argv.slice(1), {
				windowsHide: true,
				stdio: "inherit",
			});
			return r.status === 0 ? null : `npm couldn't reinstall ${version}`;
		}
		return `${channel} can't reinstall ${version}; install it with the installer or npm`;
	};
}

/**
 * The version the printed upgrade command names. On npm it is the resolved target: on
 * nightly the target can be a stable release that overtook the newest nightly.
 */
export function commandVersion(
	channel: InstallChannel,
	pinned: string | null,
	target: string,
): string | undefined {
	return pinned ?? (channel === "npm" ? target : undefined);
}

/** Whether `--version` may name `version` on this install channel. */
export function pinnedVersionValid(
	version: string,
	channel: InstallChannel,
): boolean {
	if (channel === "npm") return isExactVersion(version);
	return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * The release channel this upgrade follows. `requested` (`--channel`) is
 * validated and saved to the workspace first; a saved nightly on a non-npm
 * install falls back to stable, with a note.
 */
export function resolveUpdateChannel(
	config: Pick<
		Config,
		"readUpdateChannel" | "writeUpdateChannel" | "nightlyBlockedBy"
	>,
	workspace: string,
	channel: InstallChannel,
	requested: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): { channel: UpdateChannel; note?: string } | { error: string } {
	let saveNote: string | undefined;
	if (requested !== undefined) {
		const wanted = requested.trim().toLowerCase();
		if (wanted !== "stable" && wanted !== "nightly")
			return {
				error: `--channel takes stable or nightly, not "${requested}".`,
			};
		if (wanted === "nightly" && config.nightlyBlockedBy(channel))
			return { error: NIGHTLY_NPM_ONLY };
		config.writeUpdateChannel(workspace, wanted);
		const read = config.readUpdateChannel(workspace, env);
		saveNote =
			read === wanted
				? `Release channel set to ${wanted}.`
				: `Release channel saved as ${wanted}, but PRISMALENS_UPDATE_CHANNEL=${read} overrides it while it is set.`;
	}
	// One fallback for both paths: the env can still say nightly after --channel stable.
	const saved = config.readUpdateChannel(workspace, env);
	if (saved === "nightly" && config.nightlyBlockedBy(channel)) {
		const fallback = `This copy was installed with ${channel}, so it follows stable. ${NIGHTLY_NPM_ONLY}`;
		return {
			channel: "stable",
			note: saveNote ? `${saveNote} ${fallback}` : fallback,
		};
	}
	return saveNote ? { channel: saved, note: saveNote } : { channel: saved };
}

/**
 * For an installer copy already at the newest release: how to add the desktop app when the
 * installer's receipt says it isn't installed and wasn't declined (desktop=0).
 */
export function desktopAppHint(
	receipt: string | null,
	rerun: string,
): string | null {
	if (receipt === null || /^desktop=[01]\r?$/m.test(receipt)) return null;
	return `The desktop app isn't installed beside this copy. To add it, run the installer again: ${rerun}`;
}

/**
 * Whether the desktop app's own package (Homebrew's prismalens-app cask, Scoop's prismalens-app)
 * sits beside this copy, found from where this copy's node runs.
 */
export function appPackageInstalled(
	channel: InstallChannel,
	execPath: string = process.execPath,
	exists: (path: string) => boolean = existsSync,
): boolean {
	if (channel === "homebrew") {
		const prefix = /^(.*)\/Cellar\/prismalens\//.exec(execPath)?.[1];
		return !!prefix && exists(`${prefix}/Caskroom/prismalens-app`);
	}
	if (channel === "scoop") {
		const apps = /^(.*[\\/]apps)[\\/]prismalens[\\/]/i.exec(execPath)?.[1];
		return !!apps && exists(join(apps, "prismalens-app"));
	}
	return false;
}

/** argv to run for `channel`, or null when the user has to act (desktop); `withApp` upgrades the app's package too. */
export function upgradeArgv(
	channel: InstallChannel,
	version: string,
	platform: NodeJS.Platform = process.platform,
	withApp = false,
): string[] | null {
	const app = withApp ? ["prismalens-app"] : [];
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
			return ["brew", "upgrade", "prismalens", ...app];
		case "scoop":
			return platform === "win32"
				? ["cmd", "/c", "scoop", "update", "prismalens", ...app]
				: ["scoop", "update", "prismalens", ...app];
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
		channel: {
			type: "string",
			description:
				"Follow this release channel from now on: stable (the default) or nightly (npm installs only; switches this copy through npm's launcher)",
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
		const info = channel === "npm" ? launcherInfo(process.env) : null;
		// The service runs this install whatever workspace it serves, so its
		// workspace is the one trialled and whose channel counts; `pl upgrade` takes no --workspace (#673 w54).
		const service = config.installedService();
		const workspace = service?.workspace ?? config.getAppDataDir();

		const chosen = resolveUpdateChannel(
			config,
			workspace,
			channel,
			args.channel === undefined ? undefined : String(args.channel),
		);
		if ("error" in chosen) {
			consola.error(chosen.error);
			process.exit(1);
		}
		if (chosen.note) consola.info(chosen.note);
		const updateChannel = chosen.channel;
		// Through npm's launcher a nightly goes back to stable at once; the launcher refuses
		// when the workspace database is newer than the stable runtime (#717).
		const leaving =
			info !== null &&
			updateChannel === "stable" &&
			config.isNightlyBuild(current);
		const needsArchives = channel !== "npm" || info !== null;

		const pinned = args.version ? String(args.version).replace(/^v/, "") : null;
		// npm takes any exact version; the installer puts it into a shell command, so x.y.z only there.
		if (pinned && !pinnedVersionValid(pinned, channel)) {
			consola.error(
				channel === "npm"
					? `--version takes an exact version like 0.5.1 or 0.5.2-nightly.20261111.1, not "${pinned}".`
					: `--version takes a plain version like 0.5.1, not "${pinned}".`,
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
			if (!isNewer(pinned, current) && !(leaving && pinned !== current)) {
				consola.error(
					pinned === current
						? `PrismaLens ${current} is already installed.`
						: `${pinned} is older than the ${current} installed. A workspace ${current} has migrated won't open in ${pinned}; see https://docs.prismalens.io/install/ before going back.`,
				);
				process.exit(1);
			}
			// Refused above without the network; the archives are checked only for a version that may install.
			if (needsArchives && !(await releaseReady(pinned))) {
				consola.error(
					`There is no PrismaLens ${pinned} release with downloads attached.`,
				);
				process.exit(1);
			}
			target = pinned;
		} else {
			const latest = await fetchLatestVersion(fetch, updateChannel);
			if (!latest) {
				consola.error(
					"Couldn't reach GitHub to find the newest release. Pass --version to pick one.",
				);
				process.exit(1);
			}
			if (!isNewer(latest, current) && !leaving) {
				const note =
					updateChannel === "stable"
						? config.leavingNightlyNote(current, latest)
						: null;
				if (note) consola.info(note);
				else
					consola.success(
						`PrismaLens ${current} is the newest ${updateChannel} release.`,
					);
				const hint =
					channel === "installer"
						? desktopAppHint(
								((file) =>
									existsSync(file) ? readFileSync(file, "utf8") : null)(
									join(config.installerDataDir(), "receipt"),
								),
								config.upgradeCommand("installer", process.platform),
							)
						: null;
				if (hint) consola.info(hint);
				return;
			}
			if (needsArchives && !(await releaseReady(latest))) {
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
			commandVersion(channel, pinned, target),
			updateChannel,
		);
		if (args.check) {
			consola.info(
				`${target} is available on the ${updateChannel} channel (you have ${current}, installed with ${channel}). Upgrade with: pl upgrade${pinned ? ` --version ${pinned}` : ""}`,
			);
			return;
		}

		const plan = info ? launcherSteps(info, target, workspace) : null;
		const argv = plan
			? plan.steps[0]
			: upgradeArgv(
					channel,
					target,
					process.platform,
					appPackageInstalled(channel),
				);
		if (!argv) {
			consola.info(`The desktop app upgrades by download: ${command}`);
			return;
		}

		// A background service on this workspace is stopped for the upgrade and started again after (#732).
		const kind = config.serviceManagerKind();
		const uid = process.getuid?.() ?? 0;
		const viaService = kind !== null && service !== null;
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
						logPath: join(workspace, "logs", "service.log"),
						serviceProbe: viaService
							? () => serviceFailed(kind, uid)
							: undefined,
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
				switchBack: switchBackFor(config, trial),
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
		const lock = [workspace, config.getAppDataDir()]
			.map((w) => config.readWorkspaceLockState(w))
			.find((state) => state.kind === "held");
		if (lock?.kind === "held") {
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
					...(info && {
						runtime: {
							channel:
								process.env.PRISMALENS_RUNTIME_CHANNEL === "nightly"
									? "nightly"
									: "stable",
							version: current,
							launcher: info.version,
						},
					}),
				})
			: null;
		const steps = plan?.steps ?? [argv];
		consola.start(
			`Upgrading ${current} → ${target} with ${channel}: ${steps.map((step) => step.join(" ")).join(" && ")}`,
		);
		const result = runSteps(steps, plan?.undo ?? []);
		if (!result.ok) {
			const undone = plan?.undo.length
				? result.undone
					? ` npm's launcher is back on ${info?.version}.`
					: ` npm's launcher could not be put back: run npm install -g prismalens@${info?.version}.`
				: "";
			consola.error(
				`The upgrade stopped at ${result.failed}; ${current} is still the version that runs.${undone} Run it yourself: ${command}`,
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
			process.exit(1);
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
