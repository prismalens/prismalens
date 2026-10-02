// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	parseDistros,
	parseProbe,
	parseWslSettings,
	planWslLaunch,
	wslActive,
	wslMenuItems,
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

	it("starts the distro's service when the lock is stale", () => {
		const probe = parseProbe(`pl=1\nservice=1\ninstance={"port":6481}\nlock=${LOCK}\n`);
		expect(probe.lock.kind).toBe("stale");
		expect(planWslLaunch(probe)).toEqual({
			kind: "service",
			target: { protocol: "http", host: "localhost", port: 6481 },
		});
	});

	it("spawns on the default port for a fresh workspace", () => {
		const probe = parseProbe("pl=1\n");
		expect(probe).toMatchObject({ hasPl: true, hasService: false, port: null });
		expect(planWslLaunch(probe)).toMatchObject({
			kind: "spawn",
			target: { port: 6473 },
		});
	});

	it("reports a missing pl and an unreadable lock", () => {
		const probe = parseProbe("lock=garbage\r\n");
		expect(probe.hasPl).toBe(false);
		expect(probe.lock.kind).toBe("unreadable");
	});
});

describe("wslMenuItems", () => {
	it("checks the stored distro", () => {
		const items = wslMenuItems({ enabled: true, distro: "Debian" }, ["Ubuntu", "Debian"]);
		expect(items.toggle.checked).toBe(true);
		expect(items.distros.map((d) => [d.label, d.checked])).toEqual([
			["Default distro", false],
			["Ubuntu", false],
			["Debian", true],
		]);
	});
});
