// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthStore, writeAuthStore, setStoredCredential } from "./auth-store.js";
import { getAppDataDir } from "./utils/app-data.js";
import consola from "consola";

describe("auth-store", () => {
	let originalEnv: NodeJS.ProcessEnv;
	let dir: string;
	let consolaWarnSpy: any;

	beforeEach(() => {
		originalEnv = process.env;
		process.env = { ...originalEnv };
		dir = mkdtempSync(join(tmpdir(), "pl-auth-"));
		process.env.PRISMALENS_USER_FOLDER = dir;
		consolaWarnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(dir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("respects PRISMALENS_USER_FOLDER for auth file relocation", () => {
		setStoredCredential("openai", "test-key");
		const store = readAuthStore();
		expect(store.openai?.key).toBe("test-key");
		const dataDir = getAppDataDir();
		expect(dataDir.startsWith(dir)).toBe(true);
	});

	it("corrupt auth file degrades to {} and warns", () => {
		const authFile = join(getAppDataDir(), "auth.json");
		// Ensure dir exists
		writeAuthStore({});
		// Corrupt file
		writeFileSync(authFile, "{ corrupt: json", "utf-8");
		
		const store = readAuthStore();
		expect(store).toEqual({});
		expect(consolaWarnSpy).toHaveBeenCalledWith("Auth store file is corrupted. Treating as empty.");
	});
	it("inaccessible auth file degrades to {} and warns", () => {
		const dataDir = getAppDataDir();
		// Ensure dir exists
		writeAuthStore({ openai: { type: "api", key: "secret" } });
		// Remove permissions on the directory to cause EACCES when accessing the file
		chmodSync(dataDir, 0o000);

		const store = readAuthStore();
		expect(store).toEqual({});
		expect(consolaWarnSpy).toHaveBeenCalledWith(
			"Auth store file is inaccessible due to permissions. Treating as empty.",
		);

		// Restore permissions so rmSync can clean up
		chmodSync(dataDir, 0o700);
	});
});
