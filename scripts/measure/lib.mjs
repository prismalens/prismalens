// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Shared by the engineering-lens measures. Counting only: a measure prints its number and
// records it as a `measure/...` row in the frontend ratchet TSV. Rows only fall.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TSV = join(root, "packages/frontend/registry.ratchet.tsv");

export function sh(cmd, args, opts = {}) {
	const viaShell = process.platform === "win32" && cmd === "pnpm";
	// cmd.exe re-splits arguments, so quote the ones with spaces or metacharacters.
	const argv = viaShell
		? args.map((a) => (/[s|()]/.test(a) ? `"${a}"` : a))
		: args;
	return execFileSync(cmd, argv, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		shell: viaShell,
		stdio: ["ignore", "pipe", "pipe"],
		...opts,
	});
}

/** Records `measure/<group>` `<rule>` = n; a rise needs `--allow-raise`, a zero drops the row. */
export function record(group, rule, n, argv = process.argv) {
	const key = `measure/${group}\t${rule}`;
	const lines = existsSync(TSV)
		? readFileSync(TSV, "utf8")
				.split(/\r?\n/)
				.filter((l) => l && !l.startsWith("#"))
		: [];
	const rows = new Map(
		lines.map((l) => [
			l.split("\t").slice(0, 2).join("\t"),
			Number(l.split("\t")[2]),
		]),
	);
	const was = rows.get(key);
	if (was !== undefined && n > was && !argv.includes("--allow-raise")) {
		console.error(
			`ratchet: ${key.replace("\t", " ")} would rise from ${was} to ${n}; pass --allow-raise to record it`,
		);
		return false;
	}
	if (n > 0) rows.set(key, n);
	else rows.delete(key);
	const head =
		"# file\trule\tcount (only lowered; a raise needs the operator's label)";
	const body = [...rows].map(([k, v]) => `${k}\t${v}`).sort();
	writeFileSync(TSV, `${[head, ...body].join("\n")}\n`);
	return true;
}
