/**
 * Fan-out — run each decomposed Branch on the rented Tier-2 harness and yield the
 * merged canonical stream (ADR-0016). All iterative depth happens INSIDE a branch
 * (the rented ReAct loop); this layer only dispatches branches and relays events.
 *
 * N=1 today: one branch, so this is a straight pass-through of the single harness
 * run. When per-alert fan-out lands (a later slice) this becomes a concurrency-
 * capped merge — the (branchId, seq) stream key already disambiguates interleaved
 * branches (ADR-0008), so downstream consumers (the UI drill-down, the reduce step)
 * don't change.
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import type { Branch } from "./decompose.js";
import type { HarnessRunner } from "./investigate.js";

/** Dispatch every branch to the harness and relay its canonical events in order. */
export async function* fanOut(
	branches: Branch[],
	harness: HarnessRunner,
	runId: string,
): AsyncGenerator<CanonicalEvent> {
	for (const branch of branches) {
		yield* harness(branch.prompt, { runId, branchId: branch.branchId });
	}
}
