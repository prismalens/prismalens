// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	chmodSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import consola from "consola";
import type { LLMProviderId } from "./providers/llm.js";
import { ensureAppDataDir, getAppDataDir } from "./utils/app-data.js";

const AUTH_FILE_NAME = "auth.json";

function getAuthFilePath(): string {
	return join(getAppDataDir(), AUTH_FILE_NAME);
}

export type AuthStore = Record<string, { type: "api"; key: string }>;

export function readAuthStore(): AuthStore {
	const file = getAuthFilePath();
	try {
		const stat = statSync(file);
		// verify/repair mode on read
		if ((stat.mode & 0o777) !== 0o600) {
			chmodSync(file, 0o600);
		}
		const content = readFileSync(file, "utf-8");
		return JSON.parse(content) as AuthStore;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			((err as { code: string }).code === "EACCES" ||
				(err as { code: string }).code === "EPERM")
		) {
			consola.warn(
				"Auth store file is inaccessible due to permissions. Treating as empty.",
			);
			return {};
		}
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code: string }).code === "ENOENT"
		) {
			return {};
		}
		if (err instanceof SyntaxError) {
			consola.warn("Auth store file is corrupted. Treating as empty.");
			return {};
		}
		throw err;
	}
}

export function writeAuthStore(store: AuthStore): void {
	const file = getAuthFilePath();
	ensureAppDataDir();
	const tmpFile = `${file}.tmp`;
	writeFileSync(tmpFile, JSON.stringify(store, null, 2), { mode: 0o600 });
	renameSync(tmpFile, file);
}

export function setStoredCredential(
	provider: LLMProviderId,
	key: string,
): void {
	const store = readAuthStore();
	store[provider] = { type: "api", key };
	writeAuthStore(store);
}

export function removeStoredCredential(provider: LLMProviderId): void {
	const store = readAuthStore();
	delete store[provider];
	writeAuthStore(store);
}

export function getStoredCredential(
	provider: LLMProviderId,
): string | undefined {
	const store = readAuthStore();
	return store[provider]?.key;
}
