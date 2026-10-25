// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	admissionProblem,
	agentEnv,
	FAKE_MODEL,
	matrixSignature,
	parseArgs,
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
			r8: "missing",
			r9: "missing",
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

	it("parses R8 and R9 in verdictOf and includes them in signature (#848 C14)", () => {
		const stdout = [
			JSON.stringify({ pass: true, checks: {} }),
			"R5 resume: pass",
			"R6 user model: pass",
			"R7 resume after a failed report: pass",
			"R8 tool call, first turn: pass",
			"R9 tool call, follow-up: pass",
		].join("\n");

		const v = verdictOf(stdout);
		expect(v.r8).toBe("pass");
		expect(v.r9).toBe("pass");

		const sig = signature(v);
		expect(sig).toContain("R8=pass");
		expect(sig).toContain("R9=pass");
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

describe("admission-fake for the tier-2 agents and the signed-out row (#914)", () => {
	const model = {
		url: "http://127.0.0.1:45678",
		openaiBaseUrl: "http://127.0.0.1:45678/v1",
	};

	it("points gemini at aimock's Gemini REST from a throwaway home", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const env = agentEnv("gemini", model, tempHome);
		expect(env.GOOGLE_GEMINI_BASE_URL).toBe(model.url);
		expect(env.GEMINI_API_KEY).toBe("scripted");
		expect(env.GEMINI_CLI_HOME?.startsWith(tempHome)).toBe(true);
		const settings = JSON.parse(
			readFileSync(
				join(env.GEMINI_CLI_HOME as string, ".gemini", "settings.json"),
				"utf8",
			),
		);
		expect(settings.security.auth.selectedType).toBe("gemini-api-key");
	});

	it("points dcode's OpenAI provider at aimock from its own profile", () => {
		tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
		const env = agentEnv("deepagents", model, tempHome);
		expect(env.OPENAI_API_KEY).toBe("scripted");
		const toml = readFileSync(
			join(env.DEEPAGENTS_HOME as string, "config.toml"),
			"utf8",
		);
		expect(toml).toContain(`base_url = "${model.openaiBaseUrl}"`);
	});

	it.each(["opencode", "claude-code", "codex", "gemini", "deepagents"])(
		"leaves %s with no key when signed out, still pointed at aimock",
		(agent) => {
			tempHome = mkdtempSync(join(tmpdir(), "pl-test-home-"));
			const env = agentEnv(agent, model, tempHome, null);
			for (const key of [
				"ANTHROPIC_API_KEY",
				"OPENAI_API_KEY",
				"GEMINI_API_KEY",
			])
				expect(env[key]).toBeUndefined();
			if (agent === "opencode") {
				const config = JSON.parse(
					readFileSync(
						join(env.XDG_CONFIG_HOME as string, "opencode", "opencode.json"),
						"utf8",
					),
				);
				expect(config.provider.fake.options.apiKey).toBeUndefined();
				expect(config.model).toBe(FAKE_MODEL);
			}
		},
	);

	it("reads each matrix row's verdict word", () => {
		const out = [
			"ROW cancel: pass [cancelled; 2s]",
			"ROW http-500: fail (hung) [fault; 200s]",
			"ROW refusal: n/a (no refusal on this wire)",
		].join("\n");
		expect(matrixSignature(out)).toBe("cancel=pass http-500=fail refusal=n/a");
		expect(matrixSignature("")).toBe("no rows");
	});

	it("parses the agent, the repeat and the part to run", () => {
		expect(parseArgs(["gemini", ".", "--repeat", "3", "--only", "matrix"])).toMatchObject({
			harness: "gemini",
			repeat: 3,
			admission: false,
			matrix: true,
		});
		expect(parseArgs(["nope", "."])).toBeNull();
		expect(parseArgs(["codex", ".", "--only", "both"])).toBeNull();
	});
});

describe("admissionProblem known failures (#914)", () => {
	const v = {
		pass: false,
		failedChecks: ["cwdProved", "readAllowed"],
		r5: "fail",
		r6: "skipped",
		r7: "skipped",
		r8: "pass",
		r9: "pass",
	};

	it("accepts gemini failing exactly as its open upstream bugs predict", () => {
		expect(admissionProblem("gemini", v, 1)).toBeNull();
	});

	it("fails once gemini's known failure is fixed", () => {
		expect(admissionProblem("gemini", { ...v, r5: "pass" }, 1)).toMatch(/fixed/);
		expect(
			admissionProblem("gemini", { ...v, pass: true, failedChecks: [], r5: "pass" }, 0),
		).toMatch(/fixed/);
	});

	it("fails gemini when it fails some other way", () => {
		expect(admissionProblem("gemini", { ...v, r8: "fail" }, 1)).toMatch(/differently/);
	});

	it("keeps every other agent strict", () => {
		expect(admissionProblem("claude-code", v, 1)).toBe("the admission failed");
		expect(admissionProblem("claude-code", v, 0)).toBeNull();
	});
});
