// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type ServicesSearch = {
	team?: string;
	search?: string;
	page?: number;
	/** `1` opens the add dialog: the board's setup line links here. */
	add?: "1";
};

/**
 * The router parses `?add=1` typed by hand as the number 1 and a link's
 * `add: "1"` as the string, so both open the dialog (#1024).
 */
export function parseServicesSearch(
	raw: Record<string, unknown>,
): ServicesSearch {
	return {
		team: typeof raw.team === "string" ? raw.team : undefined,
		search: typeof raw.search === "string" ? raw.search : undefined,
		page: typeof raw.page === "number" ? raw.page : undefined,
		add: raw.add === "1" || raw.add === 1 ? "1" : undefined,
	};
}
