// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How this copy of PrismaLens was installed (#717). Homebrew, Scoop and the
 * installer all run the same standalone archive, so they are told apart by where
 * the bundled node lives; the launchers declare the rest.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const INSTALL_CHANNELS = [
	"npm",
	"installer",
	"homebrew",
	"scoop",
	"electron",
] as const;
export type InstallChannel = (typeof INSTALL_CHANNELS)[number];

export function installChannel(
	env: NodeJS.ProcessEnv = process.env,
	execPath: string = process.execPath,
): InstallChannel {
	if (env.PRISMALENS_RUN_MODE === "electron") return "electron";
	if (execPath.includes("/Cellar/prismalens/")) return "homebrew";
	if (/[\\/]scoop[\\/]apps[\\/]prismalens[\\/]/i.test(execPath)) return "scoop";
	if (env.PRISMALENS_INSTALL === "standalone") return "installer";
	return "npm";
}

const RELEASES_URL = "https://github.com/prismalens/prismalens/releases";

/** The command a user runs to upgrade this channel, optionally to `version`. */
export function upgradeCommand(
	channel: InstallChannel,
	platform: NodeJS.Platform = process.platform,
	version?: string,
): string {
	switch (channel) {
		case "installer":
			return platform === "win32"
				? `& ([scriptblock]::Create((irm https://prismalens.io/install.ps1)))${version ? ` -Version ${version}` : ""}`
				: `curl -fsSL https://prismalens.io/install.sh | sh${version ? ` -s -- --version ${version}` : ""}`;
		case "homebrew":
			return "brew upgrade prismalens";
		case "scoop":
			return version
				? `scoop install prismalens@${version}`
				: "scoop update prismalens";
		case "electron":
			return `download the desktop app from ${RELEASES_URL}/${version ? `tag/v${version}` : "latest"}`;
		default:
			return `npm install -g prismalens@${version ?? "latest"}`;
	}
}

/** The command that removes this channel's install; the workspace is never touched. */
export function uninstallCommand(
	channel: InstallChannel,
	platform: NodeJS.Platform = process.platform,
): string {
	switch (channel) {
		case "installer":
			return platform === "win32"
				? "& ([scriptblock]::Create((irm https://prismalens.io/install.ps1))) -Uninstall"
				: "curl -fsSL https://prismalens.io/install.sh | sh -s -- --uninstall";
		case "homebrew":
			return "brew uninstall prismalens";
		case "scoop":
			return "scoop uninstall prismalens";
		case "electron":
			return "quit PrismaLens and delete the app";
		default:
			return "npm uninstall -g prismalens";
	}
}

/** Where the installer keeps its runtimes and receipt. */
export function installerDataDir(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "win32") {
		return join(
			env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
			"prismalens",
		);
	}
	return join(
		env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
		"prismalens",
	);
}
