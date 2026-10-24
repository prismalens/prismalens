// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const locks = new Map<string, Promise<unknown>>();

/** Serialises every refresh of one connection across the process (#848, OBJ-007). */
export async function withConnectionLock<T>(
	connectionId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const prev = locks.get(connectionId) ?? Promise.resolve();
	const run = prev.then(fn, fn);
	const tail = run.catch(() => undefined);
	locks.set(connectionId, tail);
	try {
		return await run;
	} finally {
		if (locks.get(connectionId) === tail) locks.delete(connectionId);
	}
}
