// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One gate per thread (#1193 R15). Every approval execution holds it shared on its caller,
 * from leaving `pending` to its end; a rewind, undo or restore takes it exclusively by a try
 * that never waits, so two threads rewinding each other cannot deadlock. In-process only.
 */
interface Gate {
	shared: number;
	exclusive: boolean;
	waiting: (() => void)[];
}

const gates = new Map<string, Gate>();

function gateOf(threadId: string): Gate {
	let g = gates.get(threadId);
	if (!g) {
		g = { shared: 0, exclusive: false, waiting: [] };
		gates.set(threadId, g);
	}
	return g;
}

function settle(threadId: string, g: Gate): void {
	if (!g.exclusive) for (const wake of g.waiting.splice(0)) wake();
	if (!g.shared && !g.exclusive && !g.waiting.length) gates.delete(threadId);
}

/** Runs `work` with the thread's gate held shared; waits only while it is held exclusively. */
export async function withShared<T>(
	threadId: string,
	work: () => Promise<T>,
): Promise<T> {
	const g = gateOf(threadId);
	while (g.exclusive) await new Promise<void>((r) => g.waiting.push(r));
	g.shared += 1;
	try {
		return await work();
	} finally {
		g.shared -= 1;
		settle(threadId, g);
	}
}

/** The gate held exclusively, or null at once when anything holds it. */
export function tryExclusive(threadId: string): (() => void) | null {
	const g = gateOf(threadId);
	if (g.exclusive || g.shared > 0) {
		settle(threadId, g);
		return null;
	}
	g.exclusive = true;
	return () => {
		g.exclusive = false;
		settle(threadId, g);
	};
}
