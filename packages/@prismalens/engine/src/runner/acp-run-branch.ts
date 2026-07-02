/**
 * Branch runner — drives one rented-harness run to completion, yielding the
 * canonical event stream (ADR-0008, Slice 0).
 *
 * Consumes a transport stream of {@link AcpStreamItem}s (from {@link runAcpBranch})
 * through the {@link AcpAdapter}, then emits exactly one terminal canonical event:
 * - `branch_done` (reason mapped from the prompt `stopReason`) on completion,
 * - `error` on a transport/spawn/timeout failure or a thrown iteration error,
 *
 * so the stream ALWAYS terminates with a canonical event (the live UI never hangs).
 * Decoupled from the transport (takes any `AsyncIterable<AcpStreamItem>`) so it is
 * fixture-testable without spawning a subprocess.
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	AcpAdapter,
	type AdapterContext,
	mapStopReason,
} from "../adapter/acp-adapter.js";
import {
	type AcpClientConfig,
	type AcpStreamItem,
	runAcpBranch,
} from "./acp-client.js";

export async function* runBranch(
	items: AsyncIterable<AcpStreamItem>,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalEvent> {
	const adapter = new AcpAdapter(ctx);
	try {
		for await (const item of items) {
			if (item.kind === "update") {
				const canonical = adapter.normalize(item.update);
				if (canonical) yield canonical;
			} else if (item.kind === "done") {
				const flushed = adapter.flushText();
				if (flushed) yield flushed;
				yield adapter.branchDone(mapStopReason(item.stopReason));
				return;
			} else {
				const flushed = adapter.flushText();
				if (flushed) yield flushed;
				yield adapter.error(item.message);
				return;
			}
		}
		// Stream ended without an explicit terminal item — close it cleanly.
		const flushed = adapter.flushText();
		if (flushed) yield flushed;
		yield adapter.branchDone("submitted");
	} catch (err) {
		yield adapter.error(err instanceof Error ? err.message : String(err));
	}
}

/**
 * Convenience: spawn a deepagents ACP branch and yield the canonical stream in one
 * call (transport → adapter). Equivalent to `runBranch(runAcpBranch(config), ctx)`.
 */
export async function* runDeepAgentsBranch(
	config: AcpClientConfig,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalEvent> {
	yield* runBranch(runAcpBranch(config), ctx);
}
