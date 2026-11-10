// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
		const git = d.checks.find((c) => c.id === "git");
		expect(git?.status).toBe("ok");
		expect(git?.detail).toMatch(/^git \d+\.\d+.*\(for PrismaLens\)/);
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
		const dir = mkdtempSync(join(tmpdir(), "pl-diag-"));
		const prevPath = process.env.PATH;
		try {
			const cmdPath = join(dir, "pl.cmd");
			if (process.platform === "win32") {
				writeFileSync(cmdPath, "@echo 1.4.2\r\n");
			} else {
				const fakeCmd = join(dir, "cmd.exe");
				writeFileSync(fakeCmd, "#!/bin/sh\necho '1.4.2'\n", { mode: 0o755 });
				writeFileSync(cmdPath, "");
				process.env.PATH = `${dir}:${prevPath ?? ""}`;
			}
			expect(plVersion(cmdPath, "win32")).toBe("1.4.2");
		} finally {
			if (prevPath === undefined) delete process.env.PATH;
			else process.env.PATH = prevPath;
			rmSync(dir, { recursive: true, force: true });
		}
		expect(plVersion("Z:\\nowhere\\pl.cmd", "win32")).toBeNull();
	});
});
