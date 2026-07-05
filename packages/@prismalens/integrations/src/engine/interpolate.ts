// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Template interpolation engine for auth header values.
 * Supports {{field}} replacement and {{base64(...)}} function calls.
 */

export function interpolate(
	template: string,
	context: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		if (key in context) return context[key];
		throw new Error(`Interpolation failed: {{${key}}} not found in context`);
	});
}

export function interpolateWithFunctions(
	template: string,
	context: Record<string, string>,
): string {
	const base64Regex = /\{\{base64\((.+?)\)\}\}/g;
	const result = template.replace(base64Regex, (_, expr: string) => {
		const resolved = expr.replace(/(\w+)/g, (m: string) => {
			return context[m] ?? m;
		});
		const value = resolved
			.split("+")
			.map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
			.join("");
		return Buffer.from(value).toString("base64");
	});
	return interpolate(result, context);
}

export function interpolateRecord(
	record: Record<string, string>,
	context: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		result[key] = interpolateWithFunctions(value, context);
	}
	return result;
}
