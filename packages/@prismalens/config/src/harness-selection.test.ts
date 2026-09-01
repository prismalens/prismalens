// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agreement floor (#518).
 *
 * Four defects in a row came from "would a job start?" being answered in two
 * places from different inputs: a badge saying usable for a job the worker
 * refuses (#517), a warning against a working config, a setup step going green on
 * one the worker throws on. This table is the guard: every interesting machine
 * shape, asserted once, on the one predicate both callers now use.
 *
 * Hermetic — `isOnPath` and `homeDir` are injected, so nothing reads the PATH,
 * HOME, CLAUDE_CONFIG_DIR or provider env of whatever box runs it.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type HarnessSelectionInput,
	harnessSpeaksProvider,
	resolveHarnessAuthFor,
	resolveHarnessSelection,
	speaksOpenAiProtocol,
} from "./harness-selection.js";

const NO_BINARIES = () => false;
const CLAUDE_INSTALLED = (bin: string) => bin === "claude";
const DEEPAGENTS_INSTALLED = (bin: string) => bin === "deepagents-acp";

describe("resolveHarnessSelection — the shared gate (#518)", () => {
	let tempHome: string;

	beforeEach(() => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
		tempHome = join(
			os.tmpdir(),
			`pl-sel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempHome, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	function signIn() {
		const dir = join(tempHome, ".claude");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, ".credentials.json"), "{}");
	}

	function input(
		over: Partial<HarnessSelectionInput> = {},
	): HarnessSelectionInput {
		return {
			provider: null,
			apiKey: "",
			model: null,
			harness: "auto",
			auth: { homeDir: tempHome, isOnPath: NO_BINARIES },
			...over,
		};
	}

	describe("the machine shapes that have caused defects", () => {
		it("keyless signed-in session, no provider or model ⇒ runs on claude-code", () => {
			signIn();
			const out = resolveHarnessSelection(
				input({ auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED } }),
			);

			expect(out).toEqual({
				runnable: true,
				harness: "claude-code",
				route: "cli-session",
				verified: true,
				auto: true,
			});
		});

		/**
		 * Round 2 finding 1: the API credited a cli-session from PATH alone while
		 * the worker resolved the api-key route and threw on the missing model.
		 */
		it("real anthropic key but NO model ⇒ does not run, even with the CLI installed", () => {
			signIn();
			const out = resolveHarnessSelection(
				input({
					provider: "anthropic",
					apiKey: "sk-ant-live",
					model: null,
					auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED },
				}),
			);

			expect(out.runnable).toBe(false);
			if (!out.runnable) {
				expect(out.failure).toBe("llm-not-configured");
				expect(out.reason).toContain("LLM not configured");
			}
		});

		it("anthropic key with a model ⇒ runs on the api-key route", () => {
			const out = resolveHarnessSelection(
				input({
					provider: "anthropic",
					apiKey: "sk-ant-live",
					model: "claude-sonnet-5",
					auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED },
				}),
			);

			expect(out).toMatchObject({
				runnable: true,
				harness: "claude-code",
				route: "api-key",
			});
		});

		/**
		 * #517: an anthropic key stored while anthropic was active, then the provider
		 * switched. The key is in the env but buys claude-code nothing, because the
		 * worker only ever hands over the ACTIVE provider's credential.
		 */
		it("stored-but-inactive anthropic key ⇒ claude-code is NOT credited with it", () => {
			const stale = input({
				provider: "openai",
				apiKey: "sk-openai-live",
				model: "gpt-5.4-mini",
				harness: "claude-code",
				auth: { homeDir: tempHome, isOnPath: NO_BINARIES },
			});

			// The credential answer and the run answer agree: no key it can use, no
			// binary either, so it cannot run — never "usable via api-key".
			expect(resolveHarnessAuthFor("claude-code", stale)).toMatchObject({
				usable: false,
				cause: "not-installed",
			});
			expect(resolveHarnessSelection(stale).runnable).toBe(false);
		});

		it("that same machine WITH the CLI installed ⇒ claude-code runs on its own session", () => {
			const out = resolveHarnessSelection(
				input({
					provider: "openai",
					apiKey: "sk-openai-live",
					model: "gpt-5.4-mini",
					harness: "claude-code",
					auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED },
				}),
			);

			expect(out).toMatchObject({ runnable: true, route: "cli-session" });
		});

		it("nothing configured at all ⇒ does not run, and says the CLI is missing", () => {
			const out = resolveHarnessSelection(input());

			expect(out.runnable).toBe(false);
			if (!out.runnable) {
				expect(out.reason).toContain("not found on PATH");
				expect(out.reason).not.toContain("claude /login");
			}
		});

		it("deepagents pinned against anthropic ⇒ refused on protocol, not on credentials", () => {
			const out = resolveHarnessSelection(
				input({
					provider: "anthropic",
					apiKey: "sk-ant-live",
					model: "claude-sonnet-5",
					harness: "deepagents",
					auth: { homeDir: tempHome, isOnPath: DEEPAGENTS_INSTALLED },
				}),
			);

			expect(out.runnable).toBe(false);
			if (!out.runnable) {
				expect(out.failure).toBe("protocol-mismatch");
				expect(out.reason).toContain("only supports OpenAI-protocol providers");
			}
		});

		it("openai key with a model ⇒ auto lands on deepagents", () => {
			const out = resolveHarnessSelection(
				input({
					provider: "openai",
					apiKey: "sk-openai-live",
					model: "gpt-5.4-mini",
					auth: { homeDir: tempHome, isOnPath: DEEPAGENTS_INSTALLED },
				}),
			);

			expect(out).toMatchObject({
				runnable: true,
				harness: "deepagents",
				route: "api-key",
				auto: true,
			});
		});

		/**
		 * #519: keyless providers like local ollama satisfy deepagents without an API key.
		 */
		it("keyless ollama config with a model ⇒ admitted on deepagents (#519)", () => {
			const out = resolveHarnessSelection(
				input({
					provider: "ollama",
					apiKey: "",
					model: "gpt-oss:20b-cloud",
					auth: { homeDir: tempHome, isOnPath: DEEPAGENTS_INSTALLED },
				}),
			);

			expect(out).toEqual({
				runnable: true,
				harness: "deepagents",
				route: "api-key",
				verified: true,
				auto: true,
			});
		});

		/**
		 * #525 defect 1: claude-code with a cli-session route is auto-selected when
		 * the synthesis provider is OpenAI (ADR-0031 R4).
		 */
		it("auto-selects claude-code via cli-session when synthesis provider is openai (#525)", () => {
			signIn();
			const out = resolveHarnessSelection(
				input({
					provider: "openai",
					apiKey: "sk-openai-live",
					model: "gpt-5.4-mini",
					harness: "auto",
					auth: {
						homeDir: tempHome,
						isOnPath: (bin) => bin === "claude" || bin === "deepagents-acp",
					},
				}),
			);

			expect(out).toEqual({
				runnable: true,
				harness: "claude-code",
				route: "cli-session",
				verified: true,
				auto: true,
			});
		});

		it("an unverified session still runs — the run is the honest probe (ADR-0031 R3)", () => {
			const out = resolveHarnessSelection(
				input({ auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED } }),
			);

			expect(out).toMatchObject({ runnable: true, verified: false });
		});

		it("a bogus PRISMALENS_HARNESS is refused by name", () => {
			const out = resolveHarnessSelection(input({ envHarness: "bogus" }));

			expect(out.runnable).toBe(false);
			if (!out.runnable) {
				expect(out.failure).toBe("invalid-env-harness");
				expect(out.reason).toContain("deepagents|claude-code|codex");
			}
		});

		it("the env override beats the saved setting", () => {
			signIn();
			const out = resolveHarnessSelection(
				input({
					harness: "deepagents",
					envHarness: "claude-code",
					auth: { homeDir: tempHome, isOnPath: CLAUDE_INSTALLED },
				}),
			);

			expect(out).toMatchObject({
				runnable: true,
				harness: "claude-code",
				auto: false,
			});
		});
	});

	describe("speaksOpenAiProtocol", () => {
		it("covers exactly the OpenAI-shaped providers", () => {
			expect(speaksOpenAiProtocol("openai")).toBe(true);
			expect(speaksOpenAiProtocol("ollama")).toBe(true);
			expect(speaksOpenAiProtocol("custom")).toBe(true);
			expect(speaksOpenAiProtocol("anthropic")).toBe(false);
			expect(speaksOpenAiProtocol("google")).toBe(false);
		});
	});

	describe("harnessSpeaksProvider (#525 model gating)", () => {
		it("matches harnesses to the providers they speak", () => {
			expect(harnessSpeaksProvider("claude-code", "anthropic")).toBe(true);
			expect(harnessSpeaksProvider("claude-code", "openai")).toBe(false);
			expect(harnessSpeaksProvider("claude-code", null)).toBe(false);
			expect(harnessSpeaksProvider("deepagents", "openai")).toBe(true);
			expect(harnessSpeaksProvider("deepagents", "ollama")).toBe(true);
			expect(harnessSpeaksProvider("deepagents", "custom")).toBe(true);
			expect(harnessSpeaksProvider("deepagents", "anthropic")).toBe(false);
			expect(harnessSpeaksProvider("deepagents", null)).toBe(false);
		});
	});
});
