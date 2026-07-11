import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlConfigSchema } from "../config/schema.js";
import { resolveInvestigation } from "./run-investigation.js";

describe("resolveInvestigation", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = process.env;
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("explicit synth.provider wins", () => {
		process.env.ANTHROPIC_API_KEY = "k";
		const config = PlConfigSchema.parse({
			synth: { provider: "anthropic" },
		});
		const req = resolveInvestigation({ query: "test" }, config);
		expect(req.synth.providerId).toBe("anthropic");
		expect(req.synth.configured).toBe(true);
	});

	it("registry-order auto-selection (google only)", () => {
		process.env.GOOGLE_API_KEY = "k";
		const config = PlConfigSchema.parse({});
		const req = resolveInvestigation({ query: "test" }, config);
		expect(req.synth.providerId).toBe("google");
		expect(req.synth.configured).toBe(true);
	});

	it("registry-order auto-selection (anthropic > google)", () => {
		process.env.ANTHROPIC_API_KEY = "k";
		process.env.GOOGLE_API_KEY = "k2";
		const config = PlConfigSchema.parse({});
		const req = resolveInvestigation({ query: "test" }, config);
		expect(req.synth.providerId).toBe("anthropic");
		expect(req.synth.configured).toBe(true);
	});

	it("custom without base_url errors", () => {
		const config = PlConfigSchema.parse({
			synth: { provider: "custom" },
		});
		expect(() => resolveInvestigation({ query: "test" }, config)).toThrow(
			"Custom LLM provider requires synth.base_url to be configured.",
		);
	});

	it("no keys anywhere -> configured false", () => {
		for (const key of Object.keys(process.env)) {
			if (key.includes("API_KEY") || key.includes("BASE_URL")) {
				delete process.env[key];
			}
		}
		const config = PlConfigSchema.parse({});
		const req = resolveInvestigation({ query: "test" }, config);
		expect(req.synth.configured).toBe(false);
	});
});
