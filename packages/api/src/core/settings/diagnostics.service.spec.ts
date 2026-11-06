// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { DiagnosticsService } from "./diagnostics.service.js";

describe("DiagnosticsService", () => {
	it("runs the shared checks with the server's git and clock", () => {
		const s = new DiagnosticsService();
		s.nodeVersion = "24.22.1";
		s.git = () => ({ status: 0, stdout: "git version 2.47.0" });
		s.now = () => Date.UTC(2026, 10, 6);
		const d = s.run();
		expect(d.ranAt).toBe("2026-11-06T00:00:00.000Z");
		expect(d.checks.map((c) => c.id)).toEqual(["node", "workspace", "path", "git", "webhook-token", "service"]);
		expect(d.checks.find((c) => c.id === "git")?.detail).toContain("2.47.0");
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
});
