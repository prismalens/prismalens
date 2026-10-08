// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	runningLine,
	serviceFailed,
	unitInTransition,
	userManagerMissing,
} from "./service.js";

const reply = (out: string, ok = true) => () => ({ ok, out });

describe("serviceFailed (#776 review)", () => {
	it.each([
		["ActiveState=active\nSubState=running", false],
		["ActiveState=activating\nSubState=start", false],
		["ActiveState=activating\nSubState=auto-restart", true],
		["ActiveState=failed\nSubState=failed", true],
		["ActiveState=inactive\nSubState=dead", true],
	])("systemd %j is down: %s", (out, down) => {
		expect(serviceFailed("systemd", 1000, reply(out))).toBe(down);
	});

	it.each([
		["state = running\n\tlast exit code = (never exited)", false],
		["state = running\n\tlast exit code = 0", false],
		["state = not running\n\tlast exit code = 0", true],
		["state = spawn scheduled\n\tlast exit code = 1", true],
	])("launchd %j is down: %s", (out, down) => {
		expect(serviceFailed("launchd", 501, reply(out))).toBe(down);
	});

	it("reads a job the manager no longer knows as down", () => {
		expect(serviceFailed("launchd", 501, reply("", false))).toBe(true);
		expect(serviceFailed("systemd", 1000, reply("", false))).toBe(true);
	});
});

describe("userManagerMissing (#673)", () => {
	it("WSL without systemd as PID 1 → turn systemd on in wsl.conf", () => {
		expect(
			userManagerMissing({ wsl: true, pid1: "init", userBus: false }),
		).toMatch(/WSL isn't running systemd/);
	});
	it("systemd running but no user bus → enable linger, new shell", () => {
		const msg = userManagerMissing({
			wsl: true,
			pid1: "systemd",
			userBus: false,
		});
		expect(msg).toContain('sudo loginctl enable-linger "$(id -un)"');
		expect(msg).toMatch(/open a new shell/);
		expect(msg).not.toMatch(/wsl\.conf/);
	});
	it("a user bus that still fails → run as yourself, not sudo", () => {
		expect(
			userManagerMissing({ wsl: false, pid1: "systemd", userBus: true }),
		).toMatch(/not with sudo/);
	});
});

describe("unitInTransition (#673)", () => {
	it.each([
		["ActiveState=activating\nSubState=start", true],
		["ActiveState=deactivating\nSubState=stop-sigterm", true],
		["ActiveState=reloading\nSubState=reload", true],
		["ActiveState=activating\nSubState=auto-restart", false],
		["ActiveState=inactive\nSubState=dead", false],
		["ActiveState=active\nSubState=running", false],
	])("systemd %j in transition: %s", (out, moving) => {
		expect(unitInTransition("systemd", reply(out))).toBe(moving);
	});
	it("never for launchd or an unknown unit", () => {
		expect(unitInTransition("launchd", reply("ActiveState=activating"))).toBe(
			false,
		);
		expect(unitInTransition("systemd", reply("", false))).toBe(false);
	});
	it("status says restarting rather than no", () => {
		expect(runningLine({ kind: "not-running" }, "x", null, true)).toBe(
			"restarting",
		);
		expect(runningLine({ kind: "not-running" }, "x", null)).toBe("no");
	});
});
