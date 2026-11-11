// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About, UpdateAutoInstall } from "@prismalens/contracts";

/** One Updates row with three values over `{autoInstall, checkForUpdates}` (#1024). */
export type UpdatesValue = "notify" | "idle" | "never";

export const UPDATES_WORD: Record<UpdatesValue, string> = {
	notify: "Notify me",
	idle: "Install when idle",
	never: "Never check",
};

export function updatesValue(
	about: Pick<About, "autoInstall" | "checkForUpdates">,
): UpdatesValue {
	if (about.checkForUpdates === false) return "never";
	return about.autoInstall === "idle" ? "idle" : "notify";
}

/** The `PUT /settings/update` body for a choice; "Never check" keeps the install choice as it was. */
export function updatesPrefs(value: UpdatesValue): {
	checkForUpdates: boolean;
	autoInstall?: UpdateAutoInstall;
} {
	if (value === "never") return { checkForUpdates: false };
	return { checkForUpdates: true, autoInstall: value };
}

type Blocker = NonNullable<
	NonNullable<About["update"]["install"]>["blockedBy"]
>;

/** Why Install and restart is off, one line per reason. */
export function blockedWords(blocker: Blocker, liveRuns?: number): string {
	switch (blocker) {
		case "not_installer":
			return "Installed another way; use the command below";
		case "not_host":
			return "Install on the computer running PrismaLens";
		case "busy":
			return liveRuns && liveRuns > 0
				? `Finish or stop ${liveRuns === 1 ? "1 run" : `${liveRuns} runs`} to install`
				: "Waiting for live runs to end";
		case "disabled":
			return "Installing from the app is turned off";
	}
}

/** Install takes the installer's path only, and never while nightly blocks it. */
export function canInstall(about: About): boolean {
	const nightlyBlocked =
		about.updateChannel?.nightlyBlockedBy != null &&
		about.updateChannel.current === "nightly";
	return about.update.install?.available === true && !nightlyBlocked;
}

/** "Updates" can install when idle only where the app can install at all. */
export function idleInstallBlocked(about: About): Blocker | null {
	const b = about.update.install?.blockedBy;
	return b === "not_installer" || b === "not_host" || b === "disabled"
		? b
		: null;
}
