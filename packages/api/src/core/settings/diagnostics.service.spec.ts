// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { DiagnosticsService, plVersion } from "./diagnostics.service.js";

describe("DiagnosticsService", () => {
	it("runs the shared checks with the server's git and clock", () => {
		const s = new DiagnosticsService();
		s.nodeVersion = "24.22.1";
		s.git = () => ({ status: 0, stdout: "git version 2.47.0" });
		s.runVersion = () => null;
		s.now = () => Date.UTC(2026, 10, 6);
		const d = s.run();
		expect(d.ranAt).toBe("2026-11-06T00:00:00.000Z");
		expect(d.checks.map((c) => c.id)).toEqual(
			expect.arrayContaining(["node", "workspace", "path", "installs", "git", "webhook-token", "service"]),
		);
		expect(d.checks.find((c) => c.id === "git")?.detail).toContain("git 2.47.0 (for PrismaLens)");
	});

	it("checks git through the filtered env, real git included", () => {
		const d = new DiagnosticsService().run();
		expect(d.checks.find((c) => c.id === "git")?.status).toMatch(/ok|fail/);
	});

	it("fails the git check when the server's PATH has no git", () => {
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const git = new DiagnosticsService().run().checks.find((c) => c.id === "git");
			expect(git?.status).toBe("fail");
		} finally {
			process.env.PATH = path;
		}
	});

	it("reads a copy's version, through cmd.exe for a Windows .cmd", () => {
		expect(plVersion(process.execPath, process.platform)).toBe(process.version);
		expect(plVersion("Z:\nowhere\pl.cmd", "win32")).toBeNull();
	});
});
