// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The most rows held aside at once; past it every row is tried again, so the list stays bounded. */
const HELD_MAX = 2_000;

/**
 * Rows a delivery pass had to put off. The next pass reads past them, so they never fill its
 * batch ahead of rows that can go out; once a pass reads less than a full batch, all are retried.
 */
export class PutOff {
	private held = new Set<string>();
	private fresh = new Set<string>();

	/** The ids the next read skips. */
	skip(): string[] {
		return [...this.held];
	}

	/** A row this pass could not deliver. */
	defer(id: string): void {
		this.fresh.add(id);
	}

	/** Ends a pass that read `read` rows of a `batch`-row limit. */
	settle(read: number, batch: number): void {
		const next =
			read < batch || this.held.size + this.fresh.size > HELD_MAX
				? new Set<string>()
				: new Set([...this.held, ...this.fresh]);
		this.held = next;
		this.fresh = new Set();
	}
}
