// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isOnPath,
	resolveHarnessAuth,
} from "./harness-auth.js";

describe("harness-auth resolver (ADR-0031)", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = join(os.tmpdir(), `pl-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempHome, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempHome, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
		vi.unstubAllEnvs();
	});

	describe("claude-code harness", () => {
		it("resolves to api-key route when apiKeyPresent is true (precedence over session)", () => {
			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: true,
				homeDir: tempHome,
				isOnPath: () => true,
			});

			expect(verdict).toEqual({
				usable: true,
				route: "api-key",
			});
		});

		it("resolves to verified cli-session when apiKeyPresent is false and .credentials.json exists", () => {
			const claudeDir = join(tempHome, ".claude");
			mkdirSync(claudeDir, { recursive: true });
			writeFileSync(join(claudeDir, ".credentials.json"), JSON.stringify({ token: "test" }));

			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: (bin) => bin === "claude",
			});

			expect(verdict).toEqual({
				usable: true,
				route: "cli-session",
				verified: true,
			});
		});

		it("resolves to unverified cli-session when binary is on PATH but .credentials.json is absent", () => {
			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: (bin) => bin === "claude",
			});

			expect(verdict).toEqual({
				usable: true,
				route: "cli-session",
				verified: false,
			});
		});

		it("honours CLAUDE_CONFIG_DIR env var for credentials file location", () => {
			const customConfigDir = join(tempHome, "custom-claude-config");
			mkdirSync(customConfigDir, { recursive: true });
			writeFileSync(join(customConfigDir, ".credentials.json"), "{}");
			vi.stubEnv("CLAUDE_CONFIG_DIR", customConfigDir);

			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: () => true,
			});

			expect(verdict).toEqual({
				usable: true,
				route: "cli-session",
				verified: true,
			});
		});

		/**
		 * #518: this path is only reachable with NO key and NO binary, so the old
		 * "sign in with the Claude CLI (claude /login)" named a command the machine
		 * does not have. A signed-out but installed CLI is a usable, unverified
		 * cli-session verdict — asserted above — never this one.
		 */
		it("reports not-installed, not a login problem, when the binary is absent", () => {
			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: () => false,
			});

			expect(verdict.usable).toBe(false);
			if (!verdict.usable) {
				expect(verdict.cause).toBe("not-installed");
				expect(verdict.reason).toContain("not found on PATH");
				expect(verdict.reason).toContain("Settings → AI provider");
				expect(verdict.reason).not.toContain("claude /login");
			}
		});

		it("does not claim not-installed when the binary is present but signed out", () => {
			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: (bin) => bin === "claude",
			});

			expect(verdict).toEqual({
				usable: true,
				route: "cli-session",
				verified: false,
			});
		});
	});

	describe("deepagents harness", () => {
		it("resolves to api-key route when apiKeyPresent is true", () => {
			const verdict = resolveHarnessAuth("deepagents", {
				apiKeyPresent: true,
				homeDir: tempHome,
				isOnPath: () => false,
			});

			expect(verdict).toEqual({
				usable: true,
				route: "api-key",
			});
		});

		it("reports not-installed when neither the binary nor a key is there (#518)", () => {
			const verdict = resolveHarnessAuth("deepagents", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: () => false,
			});

			expect(verdict.usable).toBe(false);
			if (!verdict.usable) {
				expect(verdict.cause).toBe("not-installed");
				expect(verdict.reason).toContain("deepagents-acp");
				expect(verdict.reason).toContain("not found on PATH");
			}
		});

		it("reports not-authenticated when the binary is installed but no key is set", () => {
			const verdict = resolveHarnessAuth("deepagents", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: (bin) => bin === "deepagents-acp",
			});

			expect(verdict.usable).toBe(false);
			if (!verdict.usable) {
				expect(verdict.cause).toBe("not-authenticated");
				expect(verdict.reason).toBe("add an API key in Settings → AI provider");
				expect(verdict.reason).not.toContain("not found on PATH");
			}
		});
	});

	describe("codex harness (unimplemented)", () => {
		it("returns unusable because harness is not implemented even if key is present", () => {
			const verdict = resolveHarnessAuth("codex", {
				apiKeyPresent: true,
				homeDir: tempHome,
				isOnPath: () => false,
			});

			expect(verdict).toEqual({
				usable: false,
				cause: "not-implemented",
				reason: "codex harness not implemented",
			});
		});
	});

	describe("isOnPath", () => {
		it("finds an executable binary on PATH", () => {
			const binDir = join(tempHome, "bin");
			mkdirSync(binDir, { recursive: true });
			const binName = "dummy-test-bin";
			// On win32, isOnPath only probes `bin + ext` for each PATHEXT entry —
			// never the bare name — so the fixture needs a matching extension there.
			const isWin = process.platform === "win32";
			const ext = isWin ? ".CMD" : "";
			const dummyBin = join(binDir, binName + ext);
			writeFileSync(
				dummyBin,
				isWin ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
				{ mode: 0o755 },
			);
			vi.stubEnv("PATH", binDir);
			if (isWin) vi.stubEnv("PATHEXT", ".EXE;.CMD;.BAT;.COM");

			expect(isOnPath(binName)).toBe(true);
		});

		it("returns false for nonexistent binary", () => {
			vi.stubEnv("PATH", tempHome);
			expect(isOnPath("nonexistent_binary_xyz_12345")).toBe(false);
		});
	});
});
