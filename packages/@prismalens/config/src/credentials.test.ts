// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureV1, resolveCredentials } from "./credentials.js";

describe("credentials", () => {
	let originalEnv: NodeJS.ProcessEnv;
	let dir: string;

	beforeEach(() => {
		originalEnv = process.env;
		process.env = { ...originalEnv };
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY_FILE;
		delete process.env.OPENAI_BASE_URL;
		dir = mkdtempSync(join(tmpdir(), "pl-creds-"));
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(dir, { recursive: true, force: true });
	});

	const keyFile = (content: string): string => {
		const p = join(dir, "key");
		writeFileSync(p, content);
		return p;
	};

	describe("resolveCredentials", () => {
		it("direct env wins over _FILE", () => {
			process.env.OPENAI_API_KEY = "env-key";
			process.env.OPENAI_API_KEY_FILE = keyFile("file-key\n");
			const result = resolveCredentials("openai");
			expect(result.source).toBe("env");
			expect(result.apiKey).toBe("env-key");
		});

		it("no env, _FILE set → source file", () => {
			process.env.OPENAI_API_KEY_FILE = keyFile("file-key\n");
			const result = resolveCredentials("openai");
			expect(result.source).toBe("file");
			expect(result.apiKey).toBe("file-key");
		});

		it("nothing set → source none", () => {
			const result = resolveCredentials("openai");
			expect(result.source).toBe("none");
		});

		it("strips exactly one trailing newline from _FILE", () => {
			process.env.OPENAI_API_KEY_FILE = keyFile("key\n\n");
			const result = resolveCredentials("openai");
			expect(result.source).toBe("file");
			expect(result.apiKey).toBe("key\n");
		});

		it("missing _FILE points to a hard error", () => {
			process.env.OPENAI_API_KEY_FILE = join(dir, "does-not-exist");
			expect(() => resolveCredentials("openai")).toThrowError(/OPENAI_API_KEY/);
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
