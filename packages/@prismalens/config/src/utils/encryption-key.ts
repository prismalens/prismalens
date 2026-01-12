import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureAppDataDir, getAppDataDir } from "./app-data.js";

const ENCRYPTION_KEY_FILE = "PRISMALENS_ENCRYPTION_KEY_FILE";
const KEY_LENGTH = 32; // 32 bytes = 64 hex chars

/**
 * Get the path to the encryption key file.
 *
 * @returns Absolute path to ~/.prismalens/encryption-key
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
 * Get or create the encryption key.
 *
 * Priority order (following n8n's _FILE suffix convention):
 * 1. PRISMALENS_ENCRYPTION_KEY env var (direct value)
 * 2. PRISMALENS_ENCRYPTION_KEY_FILE env var (path to file)
 * 3. ~/.prismalens/encryption-key file (auto-created if missing)
 *
 * @returns The 64-character hex encryption key
 * @example
 * // Auto-generates key if not set
 * const key = getOrCreateEncryptionKey();
 *
 * // Or use explicit env var:
 * // PRISMALENS_ENCRYPTION_KEY=<64-char-hex>
 *
 * // Or use file-based secret (Docker/K8s):
 * // PRISMALENS_ENCRYPTION_KEY_FILE=/run/secrets/encryption-key
 */
export function getOrCreateEncryptionKey(): string {
	// 1. Check direct env var
	const directKey = process.env.PRISMALENS_ENCRYPTION_KEY;
	if (directKey) {
		return directKey;
	}

	// 2. Check _FILE env var (Docker/K8s secrets pattern)
	const filePathFromEnv = process.env.PRISMALENS_ENCRYPTION_KEY_FILE;
	if (filePathFromEnv && existsSync(filePathFromEnv)) {
		return readFileSync(filePathFromEnv, "utf-8").trim();
	}

	// 3. Check/create default file in .prismalens directory
	const defaultKeyPath = getEncryptionKeyPath();

	if (existsSync(defaultKeyPath)) {
		return readFileSync(defaultKeyPath, "utf-8").trim();
	}

	// Generate and store new key
	ensureAppDataDir();
	const newKey = generateEncryptionKey();
	writeFileSync(defaultKeyPath, newKey, { mode: 0o600 }); // Owner read/write only

	console.log(`Generated new encryption key at: ${defaultKeyPath}`);

	return newKey;
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
