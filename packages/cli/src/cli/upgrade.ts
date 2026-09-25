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
import { fetchLatestVersion, isNewer, releaseReady } from "./update-notice.js";

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
			"Upgrade PrismaLens the way it was installed (npm, installer, Homebrew or Scoop)",
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
			if (!(await releaseReady(pinned))) {
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

		const lock = config.readWorkspaceLockState(config.getAppDataDir());
		if (lock.kind === "held") {
			consola.error(
				`pl up is running (pid ${lock.owner.pid}). Stop it first, then run pl upgrade again.`,
			);
			process.exit(1);
		}

		const argv = upgradeArgv(channel, target);
		if (!argv) {
			consola.info(`The desktop app upgrades by download: ${command}`);
			return;
		}
		consola.start(
			`Upgrading ${current} → ${target} with ${channel}: ${argv.join(" ")}`,
		);
		const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
		if (result.status !== 0) {
			consola.error(
				`The upgrade command failed${result.error ? `: ${result.error.message}` : ""}. Run it yourself: ${command}`,
			);
			process.exit(result.status ?? 1);
		}
		consola.success(`Upgraded to ${target}. Start it with pl up.`);
	},
});
