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

		it("returns unusable with both remedies when binary is not on PATH and apiKeyPresent is false", () => {
			const verdict = resolveHarnessAuth("claude-code", {
				apiKeyPresent: false,
				homeDir: tempHome,
				isOnPath: () => false,
			});

			expect(verdict.usable).toBe(false);
			if (!verdict.usable) {
				expect(verdict.reason).toContain("Settings → AI provider");
				expect(verdict.reason).toContain("claude /login");
			}
		});
	});

	describe("deepagents harness", () => {
		it("resolves to api-key route when apiKeyPresent is true", () => {
			const verdict = resolveHarnessAuth("deepagents", {
				apiKeyPresent: true,
				homeDir: tempHome,
			});

			expect(verdict).toEqual({
				usable: true,
				route: "api-key",
			});
		});

		it("returns unusable with remedy when apiKeyPresent is false", () => {
			const verdict = resolveHarnessAuth("deepagents", {
				apiKeyPresent: false,
				homeDir: tempHome,
			});

			expect(verdict.usable).toBe(false);
			if (!verdict.usable) {
				expect(verdict.reason).toContain("Settings → AI provider");
			}
		});
	});

	describe("codex harness (unimplemented)", () => {
		it("returns unusable because harness is not implemented even if key is present", () => {
			const verdict = resolveHarnessAuth("codex", {
				apiKeyPresent: true,
				homeDir: tempHome,
			});

			expect(verdict).toEqual({
				usable: false,
				reason: "codex harness not implemented",
			});
		});
	});

	describe("isOnPath", () => {
		it("finds a common system binary like node or sh", () => {
			expect(isOnPath("node") || isOnPath("sh") || isOnPath("bash")).toBe(true);
		});

		it("returns false for nonexistent binary", () => {
			expect(isOnPath("nonexistent_binary_xyz_12345")).toBe(false);
		});
	});
});
