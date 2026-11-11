// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DiagnosticGitRun,
	runDiagnostics,
	serviceCheck,
	WINDOWS_START_AT_LOGIN,
} from "./diagnostics.js";
import { secretFileName } from "./secrets.js";

let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "pl-diag-"));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const gitOk: DiagnosticGitRun = (args) =>
	args[0] === "--version" ? { status: 0, stdout: "git version 2.47.0\n" } : { status: 1, stdout: "" };

function run(over: Partial<Parameters<typeof runDiagnostics>[0]> = {}) {
	return Object.fromEntries(
		runDiagnostics({
			workspaceDir: workspace,
			version: "0.6.0",
			git: gitOk,
			runVersion: () => "0.6.0",
			gitScope: "this shell",
			env: { PATH: ["/usr/bin", "/bin", "/a", "/b"].join(":") },
			platform: "linux",
			channel: "installer",
			service: null,
			exists: () => false,
			nodeVersion: "24.22.1",
			...over,
		}).map((c) => [c.id, c]),
	);
}

describe("runDiagnostics (#936: one set of checks for About and pl doctor)", () => {
	it("runs the machine checks and marks which ones stop pl up", () => {
		const c = run();
		expect(c.node).toMatchObject({ status: "ok", required: true, detail: "24.22.1 (patched)" });
		expect(c.workspace).toMatchObject({ status: "ok", detail: workspace, required: true });
		expect(c.path.detail).toBe("4 entries, starting /usr/bin, /bin, /a, …");
		expect(c.installs).toMatchObject({ label: "PrismaLens 0.6.0 (installer)", detail: "this one (0.6.0) is not on PATH" });
		expect(c.git).toMatchObject({ status: "ok", required: true, detail: "git 2.47.0 (for this shell); no credential helper" });
		expect(c["git-service"]).toBeUndefined();
		expect(c["webhook-token"]).toMatchObject({ status: "warn", required: false });
		expect(c.service.detail).toContain("not installed");
	});

	it("fails an unpatched Node, a missing git and an unwritable workspace", () => {
		writeFileSync(join(workspace, "file"), "x");
		const c = run({
			nodeVersion: "22.1.0",
			git: () => ({ status: null, stdout: "", error: new Error("ENOENT") }),
			workspaceDir: join(workspace, "file", "below"),
			env: {},
		});
		expect(c.node).toMatchObject({ status: "fail" });
		expect(c.git).toMatchObject({ status: "fail", required: true });
		expect(c.git.detail).toMatch(/git missing/);
		expect(c.path).toMatchObject({ status: "warn" });
		expect(c.workspace.status).toBe("fail");
	});

	it("names the credential helpers and the service's own git", () => {
		const c = run({
			git: (args) =>
				args[0] === "--version"
					? { status: 0, stdout: "git version 2.47.0" }
					: { status: 0, stdout: "credential.helper store\ncredential.https://github.com.helper manager\n" },
			service: { unitPath: "/u", workspace, port: 6473 },
		});
		expect(c.git.detail).toContain("credential helpers: all hosts: store; github.com: manager");
		expect(c["git-service"]).toMatchObject({ status: "ok", required: false });
		expect(c.service.detail).toContain("installed on port 6473");
	});

	it("warns about two copies on PATH and finds the webhook token once it exists", () => {
		writeFileSync(join(workspace, secretFileName("PRISMALENS_WEBHOOK_SECRET")), "x");
		const c = run({
			env: { PATH: "/a:/b" },
			exists: (p) => p === "/a/pl" || p === "/b/pl",
		});
		expect(c.installs.status).toBe("warn");
		expect(c.installs.detail).toContain("2 on PATH");
		expect(c["webhook-token"].status).toBe("ok");
	});
});

describe("serviceCheck with null service", () => {
	it("win32 detail is exactly not installed and directs to desktop app tray menu without pl service install", () => {
		const check = serviceCheck(null, workspace, "win32");
		expect(check.detail).toBe(
			`not installed. ${WINDOWS_START_AT_LOGIN}`,
		);
		expect(check.detail).toBe(
			"not installed. On Windows, turn on Start at login in the desktop app's tray menu.",
		);
		expect(check.detail).not.toContain("pl service install");
	});

	it.each(["linux", "darwin"] as const)(
		"%s detail is exactly not installed (pl service install runs PrismaLens in the background)",
		(platform) => {
			const check = serviceCheck(null, workspace, platform);
			expect(check.detail).toBe(
				"not installed (pl service install runs PrismaLens in the background)",
			);
		},
	);
});
