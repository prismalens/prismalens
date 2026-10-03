// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { serviceFailed } from "./service.js";

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
