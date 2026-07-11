// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	openSync,
	readFileSync,
	writeSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { ensureAppDataDir, getAppDataDir } from "./app-data.js";
import {
	FILE_SUFFIX,
	type SecretEnvVar,
	SecretEnvVars,
	secretFileName,
} from "./secrets.js";

const KEY_LENGTH = 32; // 32 bytes = 64 hex chars

/**
 * Generate a new encryption key (64 hex characters).
 *
 * @returns 64-character hex string suitable for AES-256 encryption
 */
export function generateEncryptionKey(): string {
	return randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * Generic secret resolver with file-based persistence.
 *
 * Priority order (following _FILE suffix convention for Docker/K8s):
 * 1. Direct env var (e.g. PRISMALENS_AUTH_SECRET=...)
 * 2. _FILE env var pointing to a file (e.g. PRISMALENS_AUTH_SECRET_FILE=/run/secrets/auth)
 * 3. Auto-generated file in ~/.prismalens/ (created on first run)
 *
 * @param envName - Environment variable name (e.g. "PRISMALENS_AUTH_SECRET")
 * @param length - Byte length for generated secret (default: 32 = 64 hex chars)
 */
function getOrCreateSecret(envName: SecretEnvVar, length = 32): string {
	// 1. Direct env var
	const direct = process.env[envName];
	if (direct) return direct;

	// 2. _FILE env var (Docker/K8s secrets pattern)
	const filePathFromEnv = process.env[`${envName}${FILE_SUFFIX}`];
	if (filePathFromEnv) {
		// Restrict to app data dir to prevent arbitrary file read
		const appDataDir = resolve(getAppDataDir());
		const resolvedPath = resolve(filePathFromEnv);
		if (!resolvedPath.startsWith(appDataDir + sep)) {
			throw new Error(
				`Secret file path must be within ${appDataDir}: ${filePathFromEnv}`,
			);
		}
		if (existsSync(resolvedPath)) {
			return readFileSync(resolvedPath, "utf-8").trim();
		}
	}

	// 3. Check/create in ~/.prismalens/
	const defaultPath = join(getAppDataDir(), secretFileName(envName));
	if (existsSync(defaultPath)) {
		return readFileSync(defaultPath, "utf-8").trim();
	}

	// Atomic creation: O_CREAT | O_EXCL fails if file already exists,
	// preventing TOCTOU race between concurrent processes.
	ensureAppDataDir();
	const secret = randomBytes(length).toString("hex");
	try {
		const fd = openSync(
			defaultPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
			0o600,
		);
		writeSync(fd, secret);
		closeSync(fd);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			// Another process created the file first — use their secret
			return readFileSync(defaultPath, "utf-8").trim();
		}
		throw err;
	}

	process.stderr.write(`[prismalens] Generated ${envName} → ${defaultPath}\n`);
	return secret;
}

/**
 * Get or create the encryption key.
 * Used for AES-256 encryption of sensitive data at rest.
 */
export function getOrCreateEncryptionKey(): string {
	return getOrCreateSecret(SecretEnvVars.ENCRYPTION_KEY);
}

/**
 * Get or create the internal API secret.
 * Used for worker-to-API communication via X-Internal-Secret header.
 */
export function getOrCreateInternalSecret(): string {
	return getOrCreateSecret(SecretEnvVars.INTERNAL_SECRET);
}

/**
 * Get or create the auth session secret.
 * Used by Better Auth for session signing.
 */
export function getOrCreateAuthSecret(): string {
	return getOrCreateSecret(SecretEnvVars.AUTH_SECRET);
}
