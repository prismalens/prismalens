// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DiagnosticGitRun, runDiagnostics } from "./diagnostics.js";
import { secretFileName } from "./secrets.js";

/** The fields a test sets, as the API's service holds them. */
class DiagnosticsService {
	env: NodeJS.ProcessEnv = process.env;
	nodeVersion = process.versions.node;
	git: DiagnosticGitRun = () => ({ status: 0, stdout: "git version 2" });
	run() {
		return {
			checks: runDiagnostics({
				workspaceDir: process.env.PRISMALENS_WORKSPACE_DIR as string,
				git: this.git,
				env: this.env,
				nodeVersion: this.nodeVersion,
			}),
		};
	}
}

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

describe("runDiagnostics (#936: one set of checks for About and pl doctor)", () => {
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

	it("fails a workspace it can't write, and counts several helpers or none", () => {
		process.env.PRISMALENS_WORKSPACE_DIR = join(workspace, "missing", "deeper");
		const s = new DiagnosticsService();
		s.env = { PATH: "/usr/bin" };
		s.nodeVersion = "24.22.1";
		s.git = (args) =>
			args[0] === "--version"
				? { status: 0, stdout: "git version 2.47.0" }
				: { status: 0, stdout: "credential.helper store\ncredential.https://x.helper manager\n" };
		const c = byId(s);
		expect(c.workspace).toMatchObject({ status: "fail" });
		expect(c.git.detail).toContain("2 credential helpers");
		s.git = (args) =>
			args[0] === "--version" ? { status: 0, stdout: "git version 2.47.0" } : { status: 1, stdout: "" };
		expect(byId(s).git.detail).toContain("no credential helper");
	});

	it("names the webhook token file once it exists", () => {
		writeFileSync(join(workspace, secretFileName("PRISMALENS_WEBHOOK_SECRET")), "x");
		const s = new DiagnosticsService();
		s.git = () => ({ status: 0, stdout: "git version 2" });
		expect(byId(s)["webhook-token"].status).toBe("ok");
	});
});
