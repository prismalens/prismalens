// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** A closed set: its members come from a contract's union, and each has exactly one view. */
export interface Closed<K extends string, V> {
	readonly kind: "closed";
	readonly name: string;
	readonly members: readonly K[];
	readonly views: Readonly<Record<K, V>>;
	readonly get: (member: K) => V;
}

/**
 * Lists a closed set for the manifest. `views` is a full `Record` over the
 * union, so a new member fails typecheck until it has a view; a key outside
 * `members` throws here, at startup.
 */
export function defineClosed<const K extends string, V>(
	name: string,
	members: readonly K[] | { readonly options: readonly K[] },
	views: Record<K, V>,
): Closed<K, V> {
	const list = "options" in members ? members.options : members;
	const known = new Set<string>(list);
	const extra = Object.keys(views).filter((k) => !known.has(k));
	if (extra.length)
		throw new Error(
			`closed set "${name}" has views for non-members: ${extra.join(", ")}. Remove them or add them to its union.`,
		);
	const missing = list.filter((k) => !(k in views));
	if (missing.length)
		throw new Error(
			`closed set "${name}" has no view for: ${missing.join(", ")}. Add one to its record.`,
		);
	return {
		kind: "closed",
		name,
		members: list,
		views,
		get: (m) => views[m],
	};
}
