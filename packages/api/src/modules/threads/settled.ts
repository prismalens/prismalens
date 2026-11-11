// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The settled test and the line a settle's teardown leaves (#1024 surface F); no services, so any layer imports it. */
import { fenceUntrusted } from "@prismalens/engine";

/**
 * The one settled test (#1024 surface F): settled, and nothing happened since.
 * New activity leaves `settledAt` in place, so `settledAt` alone never decides.
 */
export function isSettled(t: {
	settledAt: Date | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
}): boolean {
	return (
		t.settledAt !== null && t.settledAt >= (t.lastActivityAt ?? t.updatedAt)
	);
}

export interface Ended {
	wakes: number;
	watches: number;
	crons: number;
	cronNames: string[];
	children: number;
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** "Settling ended 2 PR watches and 1 cron job (nightly check). Re-arm what you still need." */
export function endedLine(e: Ended): string | null {
	const parts: string[] = [];
	if (e.watches) parts.push(plural(e.watches, "PR watch", "PR watches"));
	if (e.crons)
		parts.push(
			`${plural(e.crons, "cron job")}${e.cronNames.length ? ` (${e.cronNames.join(", ")})` : ""}`,
		);
	if (e.wakes) parts.push(plural(e.wakes, "scheduled wake"));
	if (e.children) parts.push(plural(e.children, "child thread"));
	if (!parts.length) return null;
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return `Settling ended ${list}. Re-arm what you still need.`;
}

/** The fenced line a thread's next turn carries after its jobs ended. */
export function endedNote(line: string): string {
	return fenceUntrusted(
		"SETTLED",
		"What PrismaLens ended when the user settled this thread.",
		line,
		"answer",
	);
}
