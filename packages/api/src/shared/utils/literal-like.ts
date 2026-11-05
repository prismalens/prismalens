// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A search as the characters typed (#1020): Prisma's `contains` on SQLite cannot escape
 * `%` or `_`, so such a search runs as raw `LIKE ? ESCAPE` with a backslash, using this pattern.
 */
export const hasWildcard = (q: string): boolean => /[%_]/.test(q);

export function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
