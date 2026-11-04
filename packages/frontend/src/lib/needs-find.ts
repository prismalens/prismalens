// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** A picker fed one page of a catalog searches the server once the page is not all of it (#1020). */
export function needsFind(
	page: { data: readonly unknown[]; total: number } | undefined,
	search: string,
): boolean {
	if (search.trim()) return true;
	return !!page && page.total > page.data.length;
}
