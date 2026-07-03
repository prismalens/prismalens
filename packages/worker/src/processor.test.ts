/**
 * Hermetic tests for `buildHarnessEnv` (ADR-0013 scope boundary): the `deepagents`
 * harness only speaks the OpenAI protocol via `OPENAI_*` env, so both
 * `OPENAI_API_KEY` and `OPENAI_BASE_URL` must be gated by provider — never leak a
 * non-OpenAI-shaped secret (anthropic/google/groq) into `OPENAI_API_KEY`
 * (worker-provider-hardwiring ledger item). No network / no LLM.
 */
import { describe, expect, it, vi } from "vitest";

// `processor.ts` opens a real ioredis connection at module load (the canonical
// event publisher) — stub it so importing the module for this pure-function test
// stays hermetic (no network).
vi.mock("ioredis", () => ({
	Redis: vi.fn(() => ({
		publish: vi.fn(),
		quit: vi.fn(),
	})),
}));

const { buildHarnessEnv, speaksOpenAiProtocol } = await import(
	"./processor.js"
);

const API_KEY = "secret-key";
const BASE_URL = "http://localhost:11434/v1";

describe("buildHarnessEnv (worker-provider-hardwiring)", () => {
	it("openai: sends OPENAI_API_KEY, no OPENAI_BASE_URL override", () => {
		expect(buildHarnessEnv("openai", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
		});
	});

	it("ollama: sends both OPENAI_API_KEY and OPENAI_BASE_URL (OpenAI-compatible)", () => {
		expect(buildHarnessEnv("ollama", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("custom: sends both OPENAI_API_KEY and OPENAI_BASE_URL (OpenAI-compatible)", () => {
		expect(buildHarnessEnv("custom", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("anthropic: does NOT leak the anthropic key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("anthropic", API_KEY, BASE_URL)).toEqual({});
	});

	it("google: does NOT leak the google key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("google", API_KEY, BASE_URL)).toEqual({});
	});

	it("groq: does NOT leak the groq key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("groq", API_KEY, BASE_URL)).toEqual({});
	});
});

describe("speaksOpenAiProtocol (deepagents pre-dispatch guard)", () => {
	it("accepts the OpenAI-protocol providers", () => {
		expect(speaksOpenAiProtocol("openai")).toBe(true);
		expect(speaksOpenAiProtocol("ollama")).toBe(true);
		expect(speaksOpenAiProtocol("custom")).toBe(true);
	});

	it("rejects providers deepagents cannot use", () => {
		expect(speaksOpenAiProtocol("anthropic")).toBe(false);
		expect(speaksOpenAiProtocol("google")).toBe(false);
		expect(speaksOpenAiProtocol("groq")).toBe(false);
	});
});
