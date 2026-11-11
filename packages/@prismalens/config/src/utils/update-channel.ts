// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which release channel an install follows (#1024): stable (the default) or
 * nightly. Kept in the workspace, beside the update cache, because `pl upgrade`
 * runs without the API and About writes it from the API.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import type { InstallChannel } from "./install-channel.js";

export const UPDATE_CHANNELS = ["stable", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

const CHANNEL_FILE = "update-channel.json";

export function isUpdateChannel(value: unknown): value is UpdateChannel {
	return value === "stable" || value === "nightly";
}

/** `PRISMALENS_UPDATE_CHANNEL` when valid, else the workspace's choice, else stable. */
export function readUpdateChannel(
	workspaceDir: string,
	env: NodeJS.ProcessEnv = process.env,
): UpdateChannel {
	const fromEnv = env.PRISMALENS_UPDATE_CHANNEL?.trim().toLowerCase();
	if (isUpdateChannel(fromEnv)) return fromEnv;
	try {
		const raw = JSON.parse(
			readFileSync(join(workspaceDir, CHANNEL_FILE), "utf8"),
		) as { channel?: unknown };
		return isUpdateChannel(raw?.channel) ? raw.channel : "stable";
	} catch {
		return "stable";
	}
}

/**
 * Creates the workspace when absent: `pl upgrade` can run before the first `pl up`.
 * Throws when the file can't be written: a setting the user chose must not be lost silently.
 */
export function writeUpdateChannel(
	workspaceDir: string,
	channel: UpdateChannel,
): void {
	mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(workspaceDir, CHANNEL_FILE),
		`${JSON.stringify({ channel })}\n`,
		{ mode: 0o600 },
	);
}

/** Why `installChannel` can't follow nightly, or null when it can. Nightlies have no archives. */
export function nightlyBlockedBy(
	installChannel: InstallChannel,
): "not_npm" | null {
	return installChannel === "npm" ? null : "not_npm";
}

export const NIGHTLY_NPM_ONLY =
	"Nightly builds ship on npm only. Install one with: npm install -g prismalens@nightly";

/**
 * What to say when a nightly install is set to stable and no stable release is
 * newer yet, or null when there is nothing to explain. A nightly may have
 * migrated the workspace past the older stable, so the install waits.
 */
export function leavingNightlyNote(
	current: string,
	latestStable: string | null,
): string | null {
	const parsed = semver.parse(current);
	if (!parsed || parsed.prerelease.length === 0) return null;
	if (
		latestStable &&
		semver.valid(latestStable) &&
		semver.gt(latestStable, current)
	)
		return null;
	const next = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
	return `You're on nightly ${current}${latestStable ? ` and stable ${latestStable} is older` : ""}. A nightly may have migrated your workspace past an older release, so this install stays on ${current} and moves to stable when ${next} or later ships.`;
}

/** The channel an update check follows: the saved one, except nightly on a copy that can't take it. */
export function effectiveUpdateChannel(
	workspaceDir: string,
	installChannel: InstallChannel,
	env: NodeJS.ProcessEnv = process.env,
): UpdateChannel {
	const saved = readUpdateChannel(workspaceDir, env);
	return saved === "nightly" && nightlyBlockedBy(installChannel)
		? "stable"
		: saved;
}
