// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import * as wslModule from "./wsl.js";
import {
	missingPlChoice,
	nothingRunningChoice,
	parseDefaultDistro,
	parseDistros,
	PATH_PREAMBLE,
	parseProbe,
	parseWslSettings,
	planWslLaunch,
	portTakenByWslDialog,
	wslActive,
	wslMenuItems,
	wslMissingPl,
	wslNothingRunning,
	wslPairOperator,
	wslProbe,
	wslShell,
} from "./wsl.js";

const LOCK = '{"pid":42,"port":6480,"host":"127.0.0.1","startedAt":"2026-10-01T00:00:00Z"}';

describe("WSL settings", () => {
	it("is off by default and for junk", () => {
		expect(parseWslSettings(null)).toEqual({ enabled: false, distro: null });
		expect(parseWslSettings("{not json")).toEqual({ enabled: false, distro: null });
		expect(parseWslSettings('{"enabled":"yes","distro":""}')).toEqual({
			enabled: false,
			distro: null,
		});
	});

	it("reads a stored switch and distro", () => {
		expect(parseWslSettings('{"enabled":true,"distro":"Ubuntu"}')).toEqual({
			enabled: true,
			distro: "Ubuntu",
		});
	});

	it("only applies on Windows", () => {
		const on = { enabled: true, distro: "Ubuntu" };
		expect(wslActive("win32", on)).toBe(true);
		expect(wslActive("linux", on)).toBe(false);
		expect(wslActive("darwin", on)).toBe(false);
		expect(wslActive("win32", { enabled: false, distro: null })).toBe(false);
	});
});

describe("parseDistros", () => {
	it("decodes wsl.exe's UTF-16LE list", () => {
		const raw = Buffer.from("﻿Ubuntu-24.04\r\nrancher-desktop\r\n\r\n", "utf16le");
		expect(parseDistros(raw)).toEqual(["Ubuntu-24.04", "rancher-desktop"]);
	});

	it("names the default distro from a `wsl.exe -l -v` listing (walk u20)", () => {
		const raw = Buffer.from(
			"﻿  NAME              STATE           VERSION\r\n* Ubuntu-24.04      Running         2\r\n  rancher-desktop   Stopped         2\r\n",
			"utf16le",
		);
		expect(parseDefaultDistro(raw)).toBe("Ubuntu-24.04");
		expect(parseDefaultDistro(Buffer.from("  NAME  STATE\r\n", "utf16le"))).toBeNull();
	});
});

describe("wslShell", () => {
	it("feeds a login bash on stdin, naming the distro when one is chosen", () => {
		expect(wslShell("Ubuntu")).toEqual({
			command: "wsl.exe",
			args: ["-d", "Ubuntu", "--", "bash", "-l", "-s"],
		});
		expect(wslShell(null).args).toEqual(["--", "bash", "-l", "-s"]);
	});
});

describe("parseProbe and planWslLaunch", () => {
	it("attaches to a live owner on localhost", () => {
		const probe = parseProbe(`pl=1\ninstance={"instanceId":"x","port":6480}\nlock=${LOCK}\nalive=1\n`);
		expect(probe.lock.kind).toBe("held");
		expect(planWslLaunch(probe)).toEqual({
			kind: "attach",
			pid: 42,
			target: { protocol: "http", host: "localhost", port: 6480 },
		});
	});

	it("reports nothing running for a stale or free lock, and never starts anything there (walk u20)", () => {
		const stale = parseProbe(`pl=1\nservice=1\ninstance={"port":6481}\nlock=${LOCK}\n`);
		expect(stale.lock.kind).toBe("stale");
		expect(planWslLaunch(stale)).toEqual({ kind: "none", reason: "nothing-running" });
		const free = parseProbe("pl=1\n");
		expect(free).toMatchObject({ hasPl: true, port: null });
		expect(planWslLaunch(free)).toEqual({ kind: "none", reason: "nothing-running" });

		// The app's whole script set: a probe and the operator pairing, nothing that starts or stops `pl`.
		expect(wslModule).not.toHaveProperty("wslUp");
		expect(wslModule).not.toHaveProperty("wslServiceStart");
		expect(wslModule).not.toHaveProperty("wslStop");
		for (const script of [wslProbe("U").script, wslPairOperator("U").script]) {
			// `kill -0` is the probe's liveness test, not a stop.
			expect(script).not.toMatch(/\bpl up\b|systemctl|\bkill (?!-0\b)/);
		}
	});

	it("asks, then retries, relaunches on the Windows copy with the switch off, or quits", () => {
		expect(wslNothingRunning("Ubuntu")).toEqual({
			message: "Nothing is running in Ubuntu",
			detail: "Run `pl up` there, or `pl service install` once. Then Retry.",
			buttons: ["Retry", "Run on Windows instead", "Quit"],
		});
		expect(wslNothingRunning(null).message).toBe("Nothing is running in the default WSL distro");
		const on = { enabled: true, distro: "Ubuntu" };
		expect(nothingRunningChoice(on, 0)).toEqual({ kind: "retry" });
		expect(nothingRunningChoice(on, 1)).toEqual({
			kind: "relaunch",
			settings: { enabled: false, distro: "Ubuntu" },
		});
		expect(nothingRunningChoice(on, 2)).toEqual({ kind: "quit" });
	});

	it("names the distro with no pl and offers Windows, Retry or Quit (#673 w49)", () => {
		expect(wslMissingPl("Ubuntu")).toEqual({
			message: "PrismaLens is not installed in the Ubuntu WSL distro",
			detail:
				"Install it there (npm install -g prismalens) so `pl` is on the login shell's PATH, or run PrismaLens on Windows instead.",
			buttons: ["Run on Windows instead", "Retry", "Quit"],
		});
		expect(wslMissingPl(null, "Debian").message).toBe(
			"PrismaLens is not installed in the default WSL distro (Debian)",
		);
		expect(wslMissingPl(null).message).toBe("PrismaLens is not installed in the default WSL distro");
		const on = { enabled: true, distro: null };
		expect(missingPlChoice(on, 0)).toEqual({
			kind: "relaunch",
			settings: { enabled: false, distro: null },
		});
		expect(missingPlChoice(on, 1)).toEqual({ kind: "retry" });
		expect(missingPlChoice(on, 2)).toEqual({ kind: "quit" });
	});

	it("keeps the instance id, and offers the WSL copy when it holds the port (#673 w50)", () => {
		expect(parseProbe(`pl=1\ninstance={"instanceId":"abc","port":6473}\n`)).toMatchObject({
			instanceId: "abc",
			port: 6473,
		});
		expect(parseProbe("pl=1\n").instanceId).toBeNull();
		expect(portTakenByWslDialog({ port: 6473, distro: "Ubuntu" })).toEqual({
			message: "Port 6473 is used by the PrismaLens running in WSL (Ubuntu)",
			detail: "Use it from this app, or stop it in WSL and relaunch to run a Windows copy here.",
			buttons: ["Use the PrismaLens in WSL", "Quit"],
		});
		expect(portTakenByWslDialog({ port: 6473, distro: null }).message).toBe(
			"Port 6473 is used by the PrismaLens running in WSL (the default distro)",
		);
	});

	it("reports a missing pl and an unreadable lock", () => {
		const probe = parseProbe("lock=garbage\r\n");
		expect(probe.hasPl).toBe(false);
		expect(probe.lock.kind).toBe("unreadable");
	});
});

describe("wslMenuItems", () => {
	it("checks the stored distro and names WSL's default", () => {
		const items = wslMenuItems({ enabled: true, distro: "Debian" }, ["Ubuntu", "Debian"], "Ubuntu");
		expect(items.toggle).toMatchObject({ label: "Use PrismaLens in WSL", checked: true });
		expect(items.distros.map((d) => [d.label, d.checked])).toEqual([
			["Default distro (Ubuntu)", false],
			["Ubuntu", false],
			["Debian", true],
		]);
		expect(wslMenuItems({ enabled: false, distro: null }, []).distros[0].label).toBe(
			"Default distro",
		);
	});
});

describe("scripts", () => {
	it("load nvm and drop Windows PATH entries before anything runs", () => {
		expect(PATH_PREAMBLE).toContain('. "$NVM_DIR/nvm.sh"');
		expect(PATH_PREAMBLE).toContain('"$NVM_DIR"/versions/node/*/bin');
		expect(PATH_PREAMBLE).toContain("grep -v '^/mnt/'");
		for (const run of [wslProbe("U"), wslPairOperator("U")]) {
			expect(run.script.startsWith(PATH_PREAMBLE)).toBe(true);
		}
	});
});
