// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveBeat } from "@prismalens/contracts";

const BEAT: LiveBeat = { beat: true };

/**
 * `source`, with a beat first and after every `ms` it stays quiet, so a client can tell a
 * silent drop from a quiet stream (#1101 category 12). Ends when `source` or `signal` ends.
 */
export async function* withBeat<T>(
	source: AsyncGenerator<T>,
	ms: number,
	signal?: AbortSignal,
): AsyncGenerator<T | LiveBeat> {
	yield BEAT;
	let next = source.next();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		while (!signal?.aborted) {
			const quiet = new Promise<"beat">((r) => {
				timer = setTimeout(() => r("beat"), ms);
			});
			const got = await Promise.race([next, quiet]);
			clearTimeout(timer);
			if (got === "beat") {
				yield BEAT;
				continue;
			}
			if (got.done) return;
			yield got.value;
			next = source.next();
		}
	} finally {
		clearTimeout(timer);
		// The source ends on the same abort; awaiting it here could wait on its pending next().
		void source.return(undefined);
	}
}
