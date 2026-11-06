// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTO_INSTALL_QUIET_MS,
	type AutoInstallFacts,
	autoInstallBlockedBy,
	installerArgv,
	installerEnv,
	readReleaseNotes,
	releaseNotesFor,
	sanitiseReleaseNotes,
	underServiceManager,
	waitForPidExit,
} from "./update-install.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pl-notes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function releaseResponse(body: string, publishedAt = "2026-11-01T00:00:00Z") {
	return new Response(JSON.stringify({ body, published_at: publishedAt }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("releaseNotesFor", () => {
	it("fetches the release body once and serves the cache for a day", async () => {
		const fetchImpl = vi.fn(async () => releaseResponse("## Fixes\n- one"));
		const now = 1_000_000;
		const first = await releaseNotesFor(dir, "0.6.0", fetchImpl, now);
		expect(first).toMatchObject({
			version: "0.6.0",
			notes: "## Fixes\n- one",
			publishedAt: "2026-11-01T00:00:00Z",
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.github.com/repos/prismalens/prismalens/releases/tags/v0.6.0",
			expect.objectContaining({ redirect: "error" }),
		);
		await releaseNotesFor(dir, "0.6.0", fetchImpl, now + 60_000);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await releaseNotesFor(dir, "0.6.0", fetchImpl, now + 25 * 3600_000);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("asks again for a different version, and keeps the old cache on failure", async () => {
		await releaseNotesFor(dir, "0.6.0", async () => releaseResponse("a"), 0);
		const failing = vi.fn(async () => new Response("", { status: 500 }));
		expect(await releaseNotesFor(dir, "0.6.1", failing, 1)).toBeNull();
		expect(readReleaseNotes(dir)?.version).toBe("0.6.0");
		const offline = vi.fn(async () => {
			throw new Error("offline");
		});
		expect(
			(await releaseNotesFor(dir, "0.6.0", offline, 25 * 3600_000))?.notes,
		).toBe("a");
	});
});

describe("sanitiseReleaseNotes", () => {
	it("drops raw HTML and script links and keeps the Markdown", () => {
		const out = sanitiseReleaseNotes(
			'## New\n<script>alert(1)</script><img src=x onerror=alert(1)>\n[x](javascript:alert(1)) [ok](https://prismalens.io) <!-- hidden -->',
		);
		expect(out).not.toMatch(/<script|<img|javascript:|hidden/);
		expect(out).toContain("## New");
		expect(out).toContain("[ok](https://prismalens.io)");
	});

	it("caps a very long body", () => {
		expect(sanitiseReleaseNotes("a".repeat(50_000)).length).toBeLessThan(20_010);
	});
});

describe("autoInstallBlockedBy", () => {
	const now = 10 * AUTO_INSTALL_QUIET_MS;
	const ready: AutoInstallFacts = {
		preference: "idle",
		channel: "installer",
		available: true,
		checkDisabled: false,
		live: false,
		quietSince: now - AUTO_INSTALL_QUIET_MS,
		installing: false,
		now,
	};

	it.each([
		[{}, null],
		[{ preference: "notify" as const }, "preference"],
		[{ channel: "npm" as const }, "not_installer"],
		[{ channel: "homebrew" as const }, "not_installer"],
		[{ channel: "scoop" as const }, "not_installer"],
		[{ channel: "electron" as const }, "not_installer"],
		[{ checkDisabled: true }, "disabled"],
		[{ available: false }, "no_update"],
		[{ installing: true }, "installing"],
		[{ live: true }, "busy"],
		[{ quietSince: now - AUTO_INSTALL_QUIET_MS + 1 }, "quiet_window"],
	])("%o → %s", (change, expected) => {
		expect(autoInstallBlockedBy({ ...ready, ...change })).toBe(expected);
	});
});

describe("restart handoff", () => {
	it("treats only the unit pl service install wrote as a service", () => {
		expect(underServiceManager({})).toBe(false);
		// A user's own unit or agent is not ours: the rollback would restart the wrong one.
		expect(underServiceManager({ INVOCATION_ID: "abc" })).toBe(false);
		expect(underServiceManager({ XPC_SERVICE_NAME: "io.prismalens.server" })).toBe(false);
		expect(underServiceManager({ XPC_SERVICE_NAME: "0" })).toBe(false);
		expect(underServiceManager({ PRISMALENS_SERVICE: "1" })).toBe(true);
	});

	it("runs the installer for a plain version only", () => {
		expect(installerArgv("0.6.0", "linux").join(" ")).toContain(
			"install.sh | sh -s -- --version 0.6.0",
		);
		expect(installerArgv("0.6.0", "win32").join(" ")).toContain("-Version 0.6.0");
		expect(installerArgv("0.6.0", "linux", "/ci/install.sh")).toEqual([
			"sh",
			"/ci/install.sh",
			"--version",
			"0.6.0",
		]);
		expect(() => installerArgv("0.6.0; rm -rf /", "linux")).toThrow();
	});

	it("drops PSModulePath on Windows only", () => {
		expect(installerEnv({ PSModulePath: "x", A: "1" }, "win32")).toEqual({ A: "1" });
		expect(installerEnv({ PSModulePath: "x" }, "linux")).toEqual({ PSModulePath: "x" });
	});

	it("waits for a pid to exit, and gives up at the deadline", async () => {
		let calls = 0;
		expect(await waitForPidExit(1, 1_000, 1, () => ++calls < 3)).toBe(true);
		expect(await waitForPidExit(1, 5, 1, () => true)).toBe(false);
	});
});
