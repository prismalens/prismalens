import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureV1, resolveCredentials } from "./credentials.js";

vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
	},
	readFileSync: vi.fn(),
}));

describe("credentials", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = process.env;
		process.env = { ...originalEnv };
		vi.resetAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("resolveCredentials", () => {
		it("direct env wins over _FILE", () => {
			process.env.OPENAI_API_KEY = "env-key";
			process.env.OPENAI_API_KEY_FILE = "/path/to/key";
			const result = resolveCredentials("openai");
			expect(result.source).toBe("env");
			expect(result.apiKey).toBe("env-key");
		});

		it("no env, _FILE set → source file", () => {
			process.env.OPENAI_API_KEY_FILE = "/path/to/key";
			const { readFileSync } = require("fs");
			readFileSync.mockReturnValue("file-key\n");
			const result = resolveCredentials("openai");
			expect(result.source).toBe("file");
			expect(result.apiKey).toBe("file-key");
		});

		it("nothing set → source none", () => {
			const result = resolveCredentials("openai");
			expect(result.source).toBe("none");
		});

		it("strips exactly one trailing newline from _FILE", () => {
			process.env.OPENAI_API_KEY_FILE = "/path/to/key";
			const { readFileSync } = require("fs");
			readFileSync.mockReturnValue("key\n\n");
			const result = resolveCredentials("openai");
			expect(result.source).toBe("file");
			expect(result.apiKey).toBe("key\n");
		});

		it("missing _FILE points to a hard error", () => {
			process.env.OPENAI_API_KEY_FILE = "/path/to/missing";
			const { readFileSync } = require("fs");
			readFileSync.mockImplementation(() => {
				throw new Error("ENOENT");
			});
			expect(() => resolveCredentials("openai")).toThrowError(
				/Failed to read OPENAI_API_KEY/,
			);
		});
	});

	describe("ensureV1", () => {
		it("appends /v1 to openai-compatible baseURLs idempotently", () => {
			expect(ensureV1("http://host")).toBe("http://host/v1");
			expect(ensureV1("http://host/")).toBe("http://host/v1");
			expect(ensureV1("http://host/v1")).toBe("http://host/v1");
			expect(ensureV1("http://host/v1/")).toBe("http://host/v1");
		});
	});
});
