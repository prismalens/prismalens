// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import envPaths from "env-paths";
import type { LLMProviderId } from "./providers/llm.js";

const AUTH_FILE_NAME = "auth.json";

function getAuthFilePath(): string {
	return join(envPaths("prismalens", { suffix: "" }).data, AUTH_FILE_NAME);
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
			(err as { code: string }).code === "ENOENT"
		) {
			return {};
		}
		throw err;
	}
}

export function writeAuthStore(store: AuthStore): void {
	const file = getAuthFilePath();
	mkdirSync(envPaths("prismalens", { suffix: "" }).data, { recursive: true });
	writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
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
