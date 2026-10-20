// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The names a vendor MCP connection's tools are offered under: `<connection>__<tool>`,
 * short enough for every agent once qualified as `mcp__prismalens__…` (#848).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { CONNECTION_NAME } from "./source-type.js";

/** 63 (the strictest agent limit found) minus `mcp__prismalens__`. */
export const OFFERED_NAME_MAX = 46;
export const OFFERED_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,45}$/;

/** Null when the name can be used, else PrismaLens's message. */
export function validateConnectionName(
	name: string,
	taken: readonly string[],
): string | null {
	if (!CONNECTION_NAME.test(name))
		return "Use up to 16 lowercase letters, digits and single underscores, starting with a letter.";
	const lower = name.toLowerCase();
	if (taken.some((t) => t.toLowerCase() === lower))
		return `Another MCP connection is already named ${name}.`;
	return null;
}

const hash = (s: string, n: number) =>
	bytesToHex(sha256(utf8ToBytes(s))).slice(0, n);

/**
 * Offered names for one connection's whole tool list, unique against `reserved`
 * (registry names and other connections). Sorted first, so catalogue order never
 * changes a name.
 */
export function allocateOfferedNames(
	connection: string,
	upstream: readonly string[],
	reserved: ReadonlySet<string>,
): Map<string, { offered: string; shortened: boolean }> {
	const prefix = `${connection}__`;
	const room = OFFERED_NAME_MAX - prefix.length;
	const used = new Set(reserved);
	const out = new Map<string, { offered: string; shortened: boolean }>();
	const withHash = (clean: string, name: string, n: number) =>
		`${prefix}${clean.slice(0, room - 1 - n)}_${hash(name, n)}`;
	let fallback = 1;
	for (const name of [...new Set(upstream)].sort()) {
		const clean = name.replace(/[^A-Za-z0-9_-]/g, "_");
		const candidates = [
			clean.length <= room ? `${prefix}${clean}` : withHash(clean, name, 6),
			...[6, 8, 10].map((n) => withHash(clean, name, n)),
		];
		let offered = candidates.find((c) => !used.has(c));
		if (!offered) {
			while (used.has(`${prefix}t${fallback}`)) fallback++;
			offered = `${prefix}t${fallback}`;
		}
		if (!OFFERED_NAME_RE.test(offered)) continue;
		used.add(offered);
		out.set(name, { offered, shortened: offered !== `${prefix}${name}` });
	}
	return out;
}
