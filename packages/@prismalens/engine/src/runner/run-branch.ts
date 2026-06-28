/**
 * Branch runner — drives one rented-harness run to completion, yielding the
 * canonical event stream (ADR-0008, Slice 0).
 *
 * Wraps a harness's `streamEvents(v2)` iterable through the adapter, then emits a
 * single terminal event:
 * - `branch_done("submitted")` on normal completion,
 * - `branch_done("budget")` on a LangGraph recursion/budget exhaustion, and
 * - `error` on any other thrown failure,
 *
 * so the stream ALWAYS terminates with a canonical event (the live UI never
 * hangs — see backlog ENG-5/FE-3).
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	type AdapterContext,
	DeepAgentsAdapter,
	type HarnessStreamEvent,
} from "../adapter/deepagents-adapter.js";

export async function* runBranch(
	events: AsyncIterable<HarnessStreamEvent>,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalEvent> {
	const adapter = new DeepAgentsAdapter(ctx);
	try {
		for await (const ev of events) {
			const canonical = adapter.normalize(ev);
			if (canonical) yield canonical;
		}
		yield adapter.branchDone("submitted");
	} catch (err) {
		// LangGraph surfaces budget exhaustion as a thrown GraphRecursionError; map
		// it to a clean terminal reason rather than a failure (verification D8).
		if (err instanceof Error && err.name === "GraphRecursionError") {
			yield adapter.branchDone("budget");
		} else {
			yield adapter.error(err instanceof Error ? err.message : String(err));
		}
	}
}
