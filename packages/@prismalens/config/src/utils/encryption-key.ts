import { randomBytes } from "crypto";
import {
	closeSync,
	constants,
	existsSync,
	openSync,
	readFileSync,
	writeSync,
} from "fs";
import { join } from "path";
import { ensureAppDataDir, getAppDataDir } from "./app-data.js";

const ENCRYPTION_KEY_FILE = "PRISMALENS_ENCRYPTION_KEY_FILE";
const KEY_LENGTH = 32; // 32 bytes = 64 hex chars

/**
 * Get the path to the encryption key file.
 *
 * @returns Absolute path to ~/.prismalens/PRISMALENS_ENCRYPTION_KEY_FILE
 */
export function getEncryptionKeyPath(): string {
	return join(getAppDataDir(), ENCRYPTION_KEY_FILE);
}

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
 * @param defaultFileName - File name in ~/.prismalens/ for persistence
 * @param length - Byte length for generated secret (default: 32 = 64 hex chars)
 */
function getOrCreateSecret(envName: string, defaultFileName: string, length = 32): string {
	// 1. Direct env var
	const direct = process.env[envName];
	if (direct) return direct;

	// 2. _FILE env var (Docker/K8s secrets pattern)
	const filePathFromEnv = process.env[`${envName}_FILE`];
	if (filePathFromEnv && existsSync(filePathFromEnv)) {
		return readFileSync(filePathFromEnv, "utf-8").trim();
	}

	// 3. Check/create in ~/.prismalens/
	const defaultPath = join(getAppDataDir(), defaultFileName);
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
 *
 * Priority order (following n8n's _FILE suffix convention):
 * 1. PRISMALENS_ENCRYPTION_KEY env var (direct value)
 * 2. PRISMALENS_ENCRYPTION_KEY_FILE env var (path to file)
 * 3. ~/.prismalens/PRISMALENS_ENCRYPTION_KEY_FILE (auto-created if missing)
 *
 * @returns The 64-character hex encryption key
 */
export function getOrCreateEncryptionKey(): string {
	return getOrCreateSecret("PRISMALENS_ENCRYPTION_KEY", ENCRYPTION_KEY_FILE);
}

/**
 * Get or create the internal API secret.
 * Used for worker-to-API communication via X-Internal-Secret header.
 */
export function getOrCreateInternalSecret(): string {
	return getOrCreateSecret("PRISMALENS_INTERNAL_SECRET", "internal-secret.key");
}

/**
 * Get or create the auth session secret.
 * Used by Better Auth for session signing.
 */
export function getOrCreateAuthSecret(): string {
	return getOrCreateSecret("PRISMALENS_AUTH_SECRET", "auth-secret.key");
}

/**
 * Validate an encryption key format.
 *
 * @param key - The key to validate
 * @returns true if valid 64-character hex string
 */
export function isValidEncryptionKey(key: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(key);
}
