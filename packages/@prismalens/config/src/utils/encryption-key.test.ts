// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getOrCreateWebhookSecret,
	setSecretNotice,
} from "./encryption-key.js";
import { FILE_SUFFIX, SecretEnvVars } from "./secrets.js";

describe("setSecretNotice and getOrCreateWebhookSecret", () => {
	let tempDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pl-enc-key-test-"));
		process.env.PRISMALENS_WORKSPACE_DIR = tempDir;
		delete process.env[SecretEnvVars.WEBHOOK_SECRET];
		delete process.env[`${SecretEnvVars.WEBHOOK_SECRET}${FILE_SUFFIX}`];
	});

	afterEach(() => {
		setSecretNotice(() => {});
		process.env = { ...originalEnv };
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("generating a new webhook secret in an empty temp workspace calls fn once with ('PRISMALENS_WEBHOOK_SECRET', <path ending in PRISMALENS_WEBHOOK_SECRET_FILE>); a second call (file exists) does not call it", () => {
		const calls: Array<[string, string]> = [];
		setSecretNotice((envName, path) => {
			calls.push([envName, path]);
		});

		const secret1 = getOrCreateWebhookSecret();
		expect(typeof secret1).toBe("string");
		expect(secret1.length).toBe(64);

		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe("PRISMALENS_WEBHOOK_SECRET");
		expect(calls[0][1].endsWith("PRISMALENS_WEBHOOK_SECRET_FILE")).toBe(true);

		const secret2 = getOrCreateWebhookSecret();
		expect(secret2).toBe(secret1);
		expect(calls).toHaveLength(1);
	});
});
