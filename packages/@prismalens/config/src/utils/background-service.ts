// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Where `pl service install` puts the background service (#732): a systemd user
 * unit on Linux, a launchd agent on macOS. Read here so `pl up`, `pl upgrade`,
 * `pl doctor` and Settings can tell whether a service owns a workspace.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SYSTEMD_UNIT_NAME = "prismalens.service";
export const LAUNCHD_LABEL = "io.prismalens.server";

export type ServiceManagerKind = "systemd" | "launchd";

export function serviceManagerKind(
	platform: NodeJS.Platform = process.platform,
): ServiceManagerKind | null {
	if (platform === "linux") return "systemd";
	if (platform === "darwin") return "launchd";
	return null;
}

export function serviceUnitPath(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string | null {
	switch (serviceManagerKind(platform)) {
		case "systemd":
			return join(
				env.XDG_CONFIG_HOME || join(home, ".config"),
				"systemd",
				"user",
				SYSTEMD_UNIT_NAME,
			);
		case "launchd":
			return join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
		default:
			return null;
	}
}

/** What an installed unit says about the process it runs. */
export interface InstalledService {
	unitPath: string;
	workspace: string;
	port: number;
	/** The bind address the unit sets; absent means pl up's default. */
	host?: string;
}

/** Reads the unit `pl service install` wrote; null when there is none. */
export function installedService(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): InstalledService | null {
	const unitPath = serviceUnitPath(platform, env, home);
	if (!unitPath || !existsSync(unitPath)) return null;
	return parseServiceUnit(readFileSync(unitPath, "utf8"), unitPath);
}

export function parseServiceUnit(
	contents: string,
	unitPath: string,
): InstalledService | null {
	const workspace =
		/^Environment="?PRISMALENS_WORKSPACE_DIR=([^"\n]*)"?$/m
			.exec(contents)?.[1]
			?.replaceAll("%%", "%") ??
		/<key>PRISMALENS_WORKSPACE_DIR<\/key>\s*<string>([^<]*)<\/string>/.exec(
			contents,
		)?.[1];
	const port =
		/^Environment="?PRISMALENS_PORT=(\d+)"?$/m.exec(contents)?.[1] ??
		/<key>PRISMALENS_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(contents)?.[1];
	const host =
		/^Environment="?PRISMALENS_HOST=([^"\n]*)"?$/m
			.exec(contents)?.[1]
			?.replaceAll("%%", "%") ??
		/<key>PRISMALENS_HOST<\/key>\s*<string>([^<]*)<\/string>/.exec(
			contents,
		)?.[1];
	if (!workspace || !port) return null;
	return {
		unitPath,
		workspace: unescapeXml(workspace),
		port: Number(port),
		...(host ? { host: unescapeXml(host) } : {}),
	};
}

/** True when the installed service runs on `workspaceDir`. */
export function serviceOwnsWorkspace(
	workspaceDir: string,
	service: InstalledService | null = installedService(),
): boolean {
	return (
		service !== null && resolve(service.workspace) === resolve(workspaceDir)
	);
}

function unescapeXml(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}
