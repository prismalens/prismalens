// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Environment variable utilities with Docker secrets support.
 *
 * Supports reading env vars from:
 * 1. Direct environment variables (process.env.VAR_NAME)
 * 2. File-based secrets via {VAR_NAME}_FILE pattern (for Docker/K8s)
 *
 * @example
 * // Read from env var or mounted secret file
 * const apiKey = readEnv('GOOGLE_API_KEY');
 *
 * // With type coercion
 * const port = readIntEnv('PORT', 3000);
 * const debug = readBoolEnv('DEBUG', false);
 */

import { readFileSync } from "fs";

/**
 * Read environment variable with file-based fallback.
 * Supports Docker/K8s secrets via {NAME}_FILE pattern.
 */
export function readEnv(name: string): string | undefined {
	if (process.env[name] !== undefined) {
		return process.env[name];
	}
	const filePath = process.env[`${name}_FILE`];
	if (filePath) {
		try {
			return readFileSync(filePath, "utf-8").replace(/\r?\n$/, "");
		} catch (error) {
			throw new Error(
				`Failed to read ${name} from file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return undefined;
}

/**
 * Read string environment variable with default.
 */
export function readStrEnv(name: string, defaultValue: string = ""): string {
	return readEnv(name) ?? defaultValue;
}

/**
 * Read integer environment variable with validation.
 */
export function readIntEnv(name: string, defaultValue: number): number {
	const value = readEnv(name);
	if (value === undefined || value === "") return defaultValue;
	const parsed = parseInt(value, 10);
	if (isNaN(parsed)) {
		throw new Error(`${name} must be a valid integer, got: ${value}`);
	}
	return parsed;
}

/**
 * Read boolean environment variable.
 * Accepts: 'true', '1', 'yes' (case-insensitive) as true
 */
export function readBoolEnv(name: string, defaultValue: boolean): boolean {
	const value = readEnv(name)?.toLowerCase();
	if (value === undefined || value === "") return defaultValue;
	return value === "true" || value === "1" || value === "yes";
}

/**
 * Read array environment variable (comma-separated).
 */
export function readArrayEnv(
	name: string,
	defaultValue: string[] = [],
): string[] {
	const value = readEnv(name);
	if (value === undefined || value === "") return defaultValue;
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}
