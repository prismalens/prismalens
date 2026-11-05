// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiagnosticsService } from "./diagnostics.service.js";

let workspace: string;
let before: string | undefined;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "pl-diag-"));
	before = process.env.PRISMALENS_WORKSPACE_DIR;
	process.env.PRISMALENS_WORKSPACE_DIR = workspace;
});
afterEach(() => {
	if (before === undefined) delete process.env.PRISMALENS_WORKSPACE_DIR;
	else process.env.PRISMALENS_WORKSPACE_DIR = before;
	rmSync(workspace, { recursive: true, force: true });
});

function byId(s: DiagnosticsService) {
	return Object.fromEntries(s.run().checks.map((c) => [c.id, c]));
}

describe("DiagnosticsService", () => {
	it("runs the doctor's checks in the server's own environment", () => {
		const s = new DiagnosticsService();
		s.env = { PATH: ["/usr/bin", "/bin", "/a", "/b"].join(process.platform === "win32" ? ";" : ":") };
		s.nodeVersion = "24.22.1";
		s.git = (args) =>
			args[0] === "--version"
				? { status: 0, stdout: "git version 2.47.0\n" }
				: { status: 0, stdout: "credential.helper store\n" };
		const c = byId(s);
		expect(c.node).toMatchObject({ status: "ok" });
		expect(c.workspace).toMatchObject({ status: "ok", detail: workspace });
		expect(c.path.detail).toContain("4 entries");
		expect(c.git.detail).toBe("git 2.47.0; 1 credential helper");
		expect(c["webhook-token"].status).toBe("warn");
		expect(c.service.status).toBe("ok");
	});

	it("fails an unpatched Node and a missing git, each with a fix", () => {
		const s = new DiagnosticsService();
		s.env = {};
		s.nodeVersion = "22.1.0";
		s.git = () => ({ status: null, stdout: "", error: new Error("ENOENT") });
		const c = byId(s);
		expect(c.node).toMatchObject({ status: "fail" });
		expect(c.node.fix).toBeTruthy();
		expect(c.git).toMatchObject({ status: "fail", fix: "Install git, then restart PrismaLens." });
		expect(c.path.status).toBe("warn");
	});
});
