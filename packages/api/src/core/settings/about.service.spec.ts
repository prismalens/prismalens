// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AboutService, latestBackup } from "./about.service.js";

const TAG = "https://github.com/prismalens/prismalens/releases/tag/v99.0.0";

/** HEAD answers: the latest redirect, then SHA256SUMS present or not. */
function github(sumsAttached: boolean): typeof fetch {
	return (async (url: string) =>
		String(url).endsWith("/SHA256SUMS")
			? new Response(null, { status: sumsAttached ? 302 : 404 })
			: new Response(null, { status: 302, headers: { location: TAG } })) as unknown as typeof fetch;
}

let workspace: string;
let before: string | undefined;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "pl-about-"));
	before = process.env.PRISMALENS_WORKSPACE_DIR;
	process.env.PRISMALENS_WORKSPACE_DIR = workspace;
});
afterEach(() => {
	if (before === undefined) delete process.env.PRISMALENS_WORKSPACE_DIR;
	else process.env.PRISMALENS_WORKSPACE_DIR = before;
	rmSync(workspace, { recursive: true, force: true });
});

function about(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
	const s = new AboutService();
	s.env = env;
	s.fetchImpl = fetchImpl;
	s.now = () => 1_000_000;
	return s.get();
}

describe("AboutService", () => {
	it("checks GitHub itself and reports a newer release with its notes", async () => {
		const a = await about({}, github(true));
		expect(a.update).toMatchObject({
			latest: "99.0.0",
			available: true,
			disabledBy: null,
			releaseNotesUrl: TAG,
		});
		expect(a.channel).toBe("npm");
		expect(a.upgradeCommand).toBe("npm install -g prismalens@latest");
		expect(a.uninstallCommand).toBe("npm uninstall -g prismalens");
	});

	it("doesn't announce a release whose downloads aren't attached yet", async () => {
		const a = await about({}, github(false));
		expect(a.update.available).toBe(false);
		expect(a.update.latest).toBe(null);
	});

	it("names the switch that turned the check off and asks GitHub nothing", async () => {
		let called = false;
		const spy = (async () => {
			called = true;
			return new Response(null, { status: 302 });
		}) as unknown as typeof fetch;
		const a = await about({ DO_NOT_TRACK: "1" }, spy);
		expect(a.update.disabledBy).toBe("DO_NOT_TRACK");
		expect(called).toBe(false);
	});

	it("names the installer's commands for an installer copy", async () => {
		const a = await about({ PRISMALENS_INSTALL: "standalone", PRISMALENS_UPDATE_CHECK: "off" }, github(true));
		expect(a.channel).toBe("installer");
		expect(a.uninstallCommand).toContain("--uninstall");
	});
});

describe("latestBackup", () => {
	it("is the newest prismalens.db.bak-*, or null", () => {
		expect(latestBackup(workspace)).toBe(null);
		writeFileSync(join(workspace, "prismalens.db.bak-1788220800000"), "");
		writeFileSync(join(workspace, "prismalens.db.bak-1789862400000"), "");
		expect(latestBackup(workspace)).toBe("prismalens.db.bak-1789862400000");
	});
});
