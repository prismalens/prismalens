// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ManifestEntry } from "./manifest.ts";

/**
 * The stored-id ledger: one row per value the database holds for an entry, committed and
 * append-only, so a shipped id is never deleted, reused or handed to another entry.
 * Row: `column<TAB>value<TAB>owner[<TAB>field=value]`.
 */
export interface LedgerRow {
	readonly column: string;
	readonly value: string;
	readonly owner: string;
	/** Tells apart owners that share a value, e.g. `host=github.com`. */
	readonly where?: string;
}

export const LEDGER_HEADER =
	"# column\tvalue\towner\twhere. Append-only: run `pnpm registry gen --write-ledger`; removing or reassigning a row needs the registry label.\n";

const keyOf = (r: Pick<LedgerRow, "column" | "value" | "where">) =>
	`${r.column}\t${r.value}\t${r.where ?? ""}`;

export function parseLedger(text: string): {
	rows: LedgerRow[];
	problems: string[];
} {
	const rows: LedgerRow[] = [];
	const problems: string[] = [];
	text.split(/\r?\n/).forEach((line, i) => {
		if (!line.trim() || line.startsWith("#")) return;
		const [column, value, owner, where] = line.split("\t");
		if (!column || !value || !owner)
			problems.push(`ledger line ${i + 1} needs column, value and owner`);
		else rows.push({ column, value, owner, ...(where ? { where } : {}) });
	});
	return { rows, problems };
}

/** Each entry's stored claims, read from the literal field the config names. */
function claims(entries: readonly ManifestEntry[], field: string): LedgerRow[] {
	return entries.flatMap((e) => {
		const list = e.fields[field];
		if (!Array.isArray(list)) return [];
		return list.flatMap((c) => {
			if (!c || typeof c !== "object" || Array.isArray(c)) return [];
			const o = c as Record<string, unknown>;
			const w = o.where as { field?: unknown; value?: unknown } | undefined;
			if (typeof o.column !== "string" || typeof o.value !== "string")
				return [];
			return [
				{
					column: o.column,
					value: o.value,
					owner: e.id,
					...(w && typeof w.field === "string" && typeof w.value === "string"
						? { where: `${w.field}=${w.value}` }
						: {}),
				},
			];
		});
	});
}

/**
 * Both directions: every row is still claimed by its owner (or an alias of it), and every
 * claim has a row naming that same owner. A claim on another owner's row is a takeover.
 */
export function ledgerProblems(
	rows: readonly LedgerRow[],
	entries: readonly ManifestEntry[],
	field: string,
): string[] {
	const out: string[] = [];
	const live = claims(entries, field);
	const byKey = new Map(live.map((c) => [keyOf(c), c]));
	const aliasOf = new Map<string, string>();
	for (const e of entries)
		for (const a of Array.isArray(e.fields.aliases) ? e.fields.aliases : [])
			if (typeof a === "string") aliasOf.set(a, e.id);
	const rowByKey = new Map<string, LedgerRow>();
	for (const r of rows) {
		const k = keyOf(r);
		if (rowByKey.has(k))
			out.push(
				`${r.column}=${r.value} ${r.where ?? ""} is in the ledger twice`,
			);
		rowByKey.set(k, r);
		const claim = byKey.get(k);
		const owner = aliasOf.get(r.owner) ?? r.owner;
		if (!claim)
			out.push(
				`the database may hold ${r.column}=${r.value}${r.where ? ` (${r.where})` : ""} for ${r.owner}, but no entry claims it`,
			);
		else if (claim.owner !== owner)
			out.push(
				`${claim.owner} claims ${r.column}=${r.value}${r.where ? ` (${r.where})` : ""}, which the ledger gives to ${r.owner}`,
			);
	}
	for (const c of live)
		if (!rowByKey.has(keyOf(c)))
			out.push(
				`${c.owner} claims ${c.column}=${c.value}${c.where ? ` (${c.where})` : ""}, which is not in the ledger yet`,
			);
	return out;
}

/** Appends a row for each new claim; existing rows are never rewritten. */
export function appendLedger(
	text: string,
	entries: readonly ManifestEntry[],
	field: string,
): string {
	const have = new Set(parseLedger(text).rows.map(keyOf));
	const add = claims(entries, field)
		.filter((c) => !have.has(keyOf(c)))
		.map((c) =>
			[c.column, c.value, c.owner, ...(c.where ? [c.where] : [])].join("\t"),
		);
	const base = text || LEDGER_HEADER;
	return add.length ? `${base.replace(/\n*$/, "\n")}${add.join("\n")}\n` : base;
}

/** Base to head: a removed row or a changed owner is what the label must approve. */
export function ledgerDiff(baseText: string, headText: string): string[] {
	const head = new Map(parseLedger(headText).rows.map((r) => [keyOf(r), r]));
	return parseLedger(baseText).rows.flatMap((r) => {
		const now = head.get(keyOf(r));
		const what = `${r.column}=${r.value}${r.where ? ` (${r.where})` : ""}`;
		if (!now) return [`ledger row ${what} (${r.owner}) was removed`];
		if (now.owner !== r.owner)
			return [`ledger row ${what} moved from ${r.owner} to ${now.owner}`];
		return [];
	});
}
