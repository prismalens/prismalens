// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { secretFileName } from "@prismalens/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AGENTS_LINE,
	checkGit,
	checkInstalls,
	checkWebhookToken,
	checkWebhookUrl,
	summary,
} from "./doctor.js";

describe("doctor — agents are the app's, never the doctor's (#907)", () => {
	it("passes with no agent anywhere, and points at Settings → Agent", () => {
		const verdict = summary([
			{ name: "Node version", pass: true, detail: "24.0.0", hard: true },
		]);
		expect(verdict).toEqual({ level: "success", line: "All required checks passed." });
		expect(AGENTS_LINE).toContain("Settings → Agent");
		expect(AGENTS_LINE).toContain("Add agent");
	});

	it("fails only on its own hard checks", () => {
		const verdict = summary([{ name: "Git", pass: false, detail: "git missing", hard: true }]);
		expect(verdict.level).toBe("error");
	});
});

describe("doctor — webhook token", () => {
	let tempDir: string;
	const originalWorkspace = process.env.PRISMALENS_WORKSPACE_DIR;

	beforeEach(() => {
		tempDir = join(
			os.tmpdir(),
			`pl-doctor-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempDir, { recursive: true });
		process.env.PRISMALENS_WORKSPACE_DIR = tempDir;
	});

	afterEach(() => {
		if (originalWorkspace === undefined) {
			delete process.env.PRISMALENS_WORKSPACE_DIR;
		} else {
			process.env.PRISMALENS_WORKSPACE_DIR = originalWorkspace;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reports webhook token file path and whether it exists without exposing the secret", () => {
		const expectedFile = join(
			tempDir,
			secretFileName("PRISMALENS_WEBHOOK_SECRET"),
		);

		// Before creation: does not exist, hard is false
		const checkBefore = checkWebhookToken();
		expect(checkBefore.name).toBe("Webhook token");
		expect(checkBefore.hard).toBe(false);
		expect(checkBefore.detail).toBe(`${expectedFile} (does not exist yet)`);

		// After creation: exists, hard is false, does NOT print the secret
		const secretValue = "super_secret_webhook_token_value_42";
		writeFileSync(expectedFile, secretValue);

		const checkAfter = checkWebhookToken();
		expect(checkAfter.name).toBe("Webhook token");
		expect(checkAfter.hard).toBe(false);
		expect(checkAfter.detail).toBe(`${expectedFile} (exists)`);
		expect(checkAfter.detail).not.toContain(secretValue);
	});
});

describe("doctor — webhook URL", () => {
	it("loopback bind: localhost URL and only this machine", () => {
		const c = checkWebhookUrl("127.0.0.1", "6473", "http");
		expect(c.name).toBe("Webhook URL");
		expect(c.detail).toContain(
			"http://127.0.0.1:6473/api/webhooks/prometheus",
		);
		expect(c.detail).toContain("only this machine can reach it");
		expect(c.detail).toMatch(/LAN or tailnet address/);
	});
	it("wildcard bind: a LAN/tailnet placeholder, reachable", () => {
		const c = checkWebhookUrl("0.0.0.0", "6473", "http");
		expect(c.detail).toContain("<this machine's LAN or tailnet address>:6473");
		expect(c.detail).toContain("other machines can reach it");
	});
	it("named host: that host's URL", () => {
		const c = checkWebhookUrl("192.168.1.5", "6473", "https");
		expect(c.detail).toContain(
			"https://192.168.1.5:6473/api/webhooks/prometheus",
		);
	});
});

describe("doctor — WSL Windows install hint", () => {
	it("adds a hint when a pl on PATH lives under /mnt/<drive>/ in WSL", () => {
		const check = checkInstalls(
			"/mnt/c/Users/sumit/AppData/Roaming/npm",
			"linux",
			{ WSL_DISTRO_NAME: "Ubuntu" },
			(p) => p === "/mnt/c/Users/sumit/AppData/Roaming/npm/pl",
		);
		expect(check.detail).toContain(
			"/mnt/c/Users/sumit/AppData/Roaming/npm/pl is the Windows install; it can't run inside WSL. Install PrismaLens inside this distro.",
		);
		expect(check.pass).toBe(false);
	});

	it("reads a Windows PATH by Windows rules whatever the host (#776 review)", () => {
		const check = checkInstalls(
			"C:\\npm;D:\\bin",
			"win32",
			{},
			(p) => p === "C:\\npm\\pl.cmd",
		);
		expect(check.detail).toContain("C:\\npm\\pl.cmd");
	});

	it("omits the hint when not running in WSL", () => {
		const check = checkInstalls(
			"/mnt/c/Users/sumit/AppData/Roaming/npm",
			"linux",
			{},
			(p) => p === "/mnt/c/Users/sumit/AppData/Roaming/npm/pl",
		);
		expect(check.detail).not.toContain("is the Windows install");
	});
});

describe("doctor — checkGit (#673, T19, T19b, T19c)", () => {
	it("T19: helper lines and the '(for this shell)' label", () => {
		const mockRun = vi.fn((args: string[]) => {
			if (args.includes("--version")) {
				return { status: 0, stdout: "git version 2.43.0\n" };
			}
			if (args.includes("--get-regexp")) {
				return {
					status: 0,
					stdout: "credential.https://github.com.helper !/usr/bin/gh auth git-credential\ncredential.helper cache\n",
				};
			}
			return { status: 0, stdout: "" };
		});

		const checks = checkGit(mockRun, null);
		expect(checks).toHaveLength(1);
		expect(checks[0].pass).toBe(true);
		expect(checks[0].name).toBe("Git");
		expect(checks[0].detail).toContain("git 2.43.0 (for this shell);");
		expect(checks[0].detail).toContain("credential helpers:");
		expect(checks[0].detail).toContain("github.com: !/usr/bin/gh auth git-credential");
		expect(checks[0].detail).toContain("all hosts: cache");
	});

	it("T19b: git missing fails", () => {
		const mockRun = vi.fn((args: string[]) => {
			if (args.includes("--version")) {
				return { status: 1, stdout: "", error: new Error("ENOENT") };
			}
			return { status: 1, stdout: "" };
		});

		const checks = checkGit(mockRun, null);
		expect(checks).toHaveLength(1);
		expect(checks[0].pass).toBe(false);
		expect(checks[0].hard).toBe(true);
		expect(checks[0].name).toBe("Git");
		expect(checks[0].detail).toMatch(/git missing/);
	});

	it("T19c: service line when installedService() is set", () => {
		const mockRun = vi.fn((args: string[]) => {
			if (args.includes("--version")) {
				return { status: 0, stdout: "git version 2.43.0\n" };
			}
			return { status: 1, stdout: "" };
		});
		const fakeService = { port: 6473, workspace: "/data" } as any;

		const checks = checkGit(mockRun, fakeService);
		expect(checks).toHaveLength(2);
		expect(checks[0].name).toBe("Git");
		expect(checks[0].detail).toContain("git 2.43.0 (for this shell); no credential helper");
		expect(checks[1].name).toBe("Git in the background service");
		expect(checks[1].pass).toBe(true);
		expect(checks[1].detail).toContain(
			"The background service runs with its own environment; helpers that need a desktop keyring or an SSH agent may not work there.",
		);
	});
});

