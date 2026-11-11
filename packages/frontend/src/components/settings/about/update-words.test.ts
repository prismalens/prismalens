// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AboutSchema, type About } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	type AboutWithChannel,
	blockedWords,
	canInstall,
	idleInstallBlocked,
	updatesPrefs,
	updatesValue,
} from "./update-words";

function makeAbout(overrides: Partial<About> = {}): About {
	const base: About = {
		version: "0.5.4",
		channel: "npm",
		build: null,
		workspaceDir: "/var/prismalens",
		latestBackup: null,
		update: {
			latest: "0.5.4",
			available: false,
			checkedAt: "2026-11-11T00:00:00Z",
			disabledBy: null,
			releaseNotesUrl: null,
			install: { available: false },
		},
		upgradeCommand: "npm i -g @prismalens/cli",
		uninstallCommand: "npm rm -g @prismalens/cli",
		...overrides,
	};
	return AboutSchema.parse(base);
}

describe("update-words", () => {
	it("derives updatesValue for disabled check, idle auto-install, and empty preferences", () => {
		expect(
			updatesValue({ checkForUpdates: false, autoInstall: "idle" }),
		).toBe("never");
		expect(updatesValue({ autoInstall: "idle" })).toBe("idle");
		expect(updatesValue({})).toBe("notify");
	});

	it("creates update preferences payload for never, idle, and notify", () => {
		expect(updatesPrefs("never")).toEqual({ checkForUpdates: false });
		expect(updatesPrefs("idle")).toEqual({
			checkForUpdates: true,
			autoInstall: "idle",
		});
		expect(updatesPrefs("notify")).toEqual({
			checkForUpdates: true,
			autoInstall: "notify",
		});
	});

	it("formats explanation copy across all install blocker reasons and live run counts", () => {
		expect(blockedWords("not_installer")).toBe(
			"Installed another way; use the command below",
		);
		expect(blockedWords("not_host")).toBe(
			"Install on the computer running PrismaLens",
		);
		expect(blockedWords("busy", 2)).toBe("Finish or stop 2 runs to install");
		expect(blockedWords("busy", 1)).toBe("Finish or stop 1 run to install");
		expect(blockedWords("busy", undefined)).toBe(
			"Waiting for live runs to end",
		);
		expect(blockedWords("disabled")).toBe(
			"Installing from the app is turned off",
		);
	});

	it("determines whether install and restart is permitted from About status", () => {
		const availableAbout = makeAbout({
			update: {
				latest: "0.5.5",
				available: true,
				checkedAt: "2026-11-11T00:00:00Z",
				disabledBy: null,
				releaseNotesUrl: null,
				install: { available: true },
			},
		});
		expect(canInstall(availableAbout)).toBe(true);

		const busyAbout = makeAbout({
			update: {
				latest: "0.5.5",
				available: true,
				checkedAt: "2026-11-11T00:00:00Z",
				disabledBy: null,
				releaseNotesUrl: null,
				install: { available: false, blockedBy: "busy" },
			},
		});
		expect(canInstall(busyAbout)).toBe(false);

		const nightlyAbout: AboutWithChannel = {
			...availableAbout,
			updateChannel: {
				current: "nightly",
				nightlyBlockedBy: "not_npm",
				fromEnv: false,
				leavingNightly: null,
			},
		};
		expect(canInstall(nightlyAbout)).toBe(false);
	});

	it("distinguishes persistent blockers from transient busy state in idleInstallBlocked", () => {
		const busyAbout = makeAbout({
			update: {
				latest: "0.5.5",
				available: true,
				checkedAt: "2026-11-11T00:00:00Z",
				disabledBy: null,
				releaseNotesUrl: null,
				install: { available: false, blockedBy: "busy" },
			},
		});
		expect(idleInstallBlocked(busyAbout)).toBeNull();

		const hostAbout = makeAbout({
			update: {
				latest: "0.5.5",
				available: true,
				checkedAt: "2026-11-11T00:00:00Z",
				disabledBy: null,
				releaseNotesUrl: null,
				install: { available: false, blockedBy: "not_host" },
			},
		});
		expect(idleInstallBlocked(hostAbout)).toBe("not_host");
	});
});
