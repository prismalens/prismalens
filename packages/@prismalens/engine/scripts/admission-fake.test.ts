// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FAKE_MODEL,
	agentEnv,
	signature,
	verdictOf,
} from "../../../../scripts/admission-fake.mjs";

// A throwaway HOME keeps runner credentials out of agent environments during test runs.
let tempHome: string | undefined;

afterEach(() => {
	if (tempHome) {
		rmSync(tempHome, { recursive: true, force: true });
		tempHome = undefined;
	}
});

describe("admission-fake verdictOf and signature", () => {
	it("parses passing report with check results and R-lines", () => {
		const report = {
			pass: true,
			checks: {
				toolRan: true,
				reportValid: true,
				evidenceMatches: true,
			},
		};
		const stdout = [
			"preamble",
			JSON.stringify(report, null, 2),
			"R5 resume: pass (the reply named the alert)",
			"R6 user model: pass (user model was respected)",
			"R7 resume after a failed report: skipped (disabled in quick run)",
		].join("\n");

		const verdict = verdictOf(stdout);
		expect(verdict).toEqual({
			pass: true,
			failedChecks: [],
			r5: "pass",
			r6: "pass",
			r7: "skipped",
		});
	});

	it("extracts failed checks, marks missing R-lines, and marks garbage as failed", () => {
		const report = {
			pass: false,
			checks: {
				toolRan: false,
				reportValid: false,
				evidenceMatches: true,
			},
		};
		const stdout = [
			JSON.stringify(report, null, 2),
			"R5 resume: pass (the reply named the alert)",
		].join("\n");

		const verdict = verdictOf(stdout);
		expect(verdict.pass).toBe(false);
		expect(verdict.failedChecks).toEqual(["toolRan", "reportValid"]);
		expect(verdict.r5).toBe("pass");
		expect(verdict.r6).toBe("missing");
		expect(verdict.r7).toBe("missing");

		const garbageVerdict = verdictOf("some random output with no json");
		expect(garbageVerdict.pass).toBe(false);
		expect(garbageVerdict.failedChecks).toEqual([]);
		expect(garbageVerdict.r5).toBe("missing");
		expect(garbageVerdict.r6).toBe("missing");
		expect(garbageVerdict.r7).toBe("missing");
	});

	it("produces deterministic signatures that vary with any single field change", () => {
		const base = {
			pass: true,
			failedChecks: [],
			r5: "pass",
			r6: "pass",
			r7: "skipped",
		};
		const sigBase = signature(base);
		expect(signature({ ...base })).toBe(sigBase);

		expect(signature({ ...base, pass: false })).not.toBe(sigBase);
		expect(
			signature({ ...base, pass: false, failedChecks: ["toolRan"] }),
		).not.toBe(sigBase);
		expect(signature({ ...base, r5: "fail" })).not.toBe(sigBase);
		expect(signature({ ...base, r6: "fail" })).not.toBe(sigBase);
		expect(signature({ ...base, r7: "fail" })).not.toBe(sigBase);
	});
});

describe("admission-fake agentEnv", () => {
	it("configures opencode environment pointing to loopback fake", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const fake = {
			url: "http://127.0.0.1:45678",
			openaiBaseUrl: "http://127.0.0.1:45678/v1",
		};

		const env = agentEnv("opencode", fake, tempHome);
		expect(env.XDG_CONFIG_HOME?.startsWith(tempHome)).toBe(true);
		expect(env.PRISMALENS_HARNESS_MODEL).toBe(FAKE_MODEL);

		const configFile = join(
			env.XDG_CONFIG_HOME as string,
			"opencode",
			"opencode.json",
		);
		const config = JSON.parse(readFileSync(configFile, "utf8"));
		expect(config.provider.fake.options.baseURL).toBe(fake.openaiBaseUrl);
		expect(config.provider.fake.models.scripted).toBeDefined();
		expect(
			new URL(config.provider.fake.options.baseURL).hostname,
		).toBe("127.0.0.1");
	});

	it("configures claude-code environment pointing to loopback fake", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const fake = {
			url: "http://127.0.0.1:45678",
			openaiBaseUrl: "http://127.0.0.1:45678/v1",
		};

		const env = agentEnv("claude-code", fake, tempHome);
		expect(env.ANTHROPIC_BASE_URL).toBe(fake.url);
		expect(typeof env.ANTHROPIC_API_KEY).toBe("string");
		expect(env.ANTHROPIC_API_KEY?.length).toBeGreaterThan(0);
		expect(env.CLAUDE_CONFIG_DIR?.startsWith(tempHome)).toBe(true);
		expect(env.PRISMALENS_HARNESS_MODEL).toBeUndefined();
	});

	it("configures a codex home whose provider speaks Responses to the loopback fake", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const fake = {
			url: "http://127.0.0.1:45678",
			openaiBaseUrl: "http://127.0.0.1:45678/v1",
		};

		const env = agentEnv("codex", fake, tempHome);
		expect(env.CODEX_HOME?.startsWith(tempHome)).toBe(true);
		expect(env.OPENAI_API_KEY).toBe("scripted");
		const toml = readFileSync(join(env.CODEX_HOME as string, "config.toml"), "utf8");
		expect(toml).toContain(`base_url = "${fake.openaiBaseUrl}"`);
		expect(toml).toContain('wire_api = "responses"');
		expect(toml).toContain('env_key = "OPENAI_API_KEY"');
	});

	it("contains no PRISMALENS_ keys other than PRISMALENS_HARNESS_MODEL", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const fake = {
			url: "http://127.0.0.1:45678",
			openaiBaseUrl: "http://127.0.0.1:45678/v1",
		};

		const opencodeEnv = agentEnv("opencode", fake, tempHome);
		const opencodePrismaKeys = Object.keys(opencodeEnv).filter(
			(k) => k.startsWith("PRISMALENS_") && k !== "PRISMALENS_HARNESS_MODEL",
		);
		expect(opencodePrismaKeys).toEqual([]);

		const claudeEnv = agentEnv("claude-code", fake, tempHome);
		const claudePrismaKeys = Object.keys(claudeEnv).filter(
			(k) => k.startsWith("PRISMALENS_") && k !== "PRISMALENS_HARNESS_MODEL",
		);
		expect(claudePrismaKeys).toEqual([]);
	});
});
