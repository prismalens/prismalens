// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * ForkRunner settlement rules around the report→exit window.
 *
 * The child sends its `result` and then calls `process.disconnect()` before exiting
 * (`packages/worker/src/index.ts`), while the runner deliberately withholds settlement
 * until the exit. That window is where a user's Cancel lands, and nothing that happens
 * inside it may rewrite an already-reported verdict.
 *
 * `node:child_process` is faked so the window can be driven exactly. The fake reproduces
 * the one behaviour under test from Node's own contract: `send()` on a closed channel
 * reports through the callback when one is given, and emits `error` on the child when
 * one is not.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSink } from "./dispatcher.js";
import { createForkRunner } from "./fork-runner.js";
import type { ClaimedJob } from "./job-store.js";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: forkMock }));

class FakeChild extends EventEmitter {
	connected = true;
	readonly sent: unknown[] = [];
	readonly signals: string[] = [];

	send(
		message: unknown,
		callback?: (error: Error | null) => void,
	): boolean {
		if (!this.connected) {
			const error = new Error("channel closed");
			if (callback) callback(error);
			else this.emit("error", error);
			return false;
		}
		this.sent.push(message);
		callback?.(null);
		return true;
	}

	kill(signal: string): boolean {
		this.signals.push(signal);
		return true;
	}

	/** What the worker does right after it reports its result. */
	disconnect(): void {
		this.connected = false;
	}
}

function claimedJob(): ClaimedJob {
	return {
		id: "job-1",
		kind: "investigation",
		investigationId: "inv-1",
		incidentId: "inc-1",
		payload: JSON.stringify({ investigationId: "inv-1" }),
		priority: 3,
		attempts: 1,
		maxAttempts: 3,
		claimToken: "claim-1",
	};
}

const sink: RunSink = {
	onEvent: () => {},
	onStreamDone: () => {},
	onProgress: () => {},
};

describe("createForkRunner", () => {
	let child: FakeChild;

	beforeEach(() => {
		vi.clearAllMocks();
		child = new FakeChild();
		forkMock.mockReturnValue(child);
	});

	function start() {
		const runner = createForkRunner({ entry: "/fake/worker/entry.js" });
		return runner(claimedJob(), sink);
	}

	it("keeps a reported success when a cancel arrives after the child disconnected", async () => {
		const running = start();

		// The worker reports, then disconnects its IPC channel; the runner holds the
		// verdict until the exit proves teardown finished.
		child.emit("message", {
			type: "result",
			outcome: "succeeded",
			retryable: false,
		});
		child.disconnect();

		// Cancel pressed as the run finishes — precisely when people press Cancel.
		running.cancel();
		child.emit("exit", 0, null);

		await expect(running.done).resolves.toEqual({
			outcome: "succeeded",
			retryable: false,
		});
		// Nothing was pushed at a channel that is gone.
		expect(child.sent).not.toContainEqual({ type: "cancel" });
	});

	it("keeps a reported success when the child errors after reporting", async () => {
		const running = start();

		child.emit("message", {
			type: "result",
			outcome: "succeeded",
			retryable: false,
		});
		child.emit("error", new Error("write EPIPE"));
		child.emit("exit", 0, null);

		await expect(running.done).resolves.toEqual({
			outcome: "succeeded",
			retryable: false,
		});
	});

	it("delivers the cancel while the channel is still live", async () => {
		const running = start();

		running.cancel();

		expect(child.sent).toContainEqual({ type: "cancel" });

		child.emit("exit", null, "SIGTERM");
		await expect(running.done).resolves.toEqual({
			outcome: "cancelled",
			retryable: false,
		});
	});

	it("still settles a crash that never reported as a retryable failure", async () => {
		const running = start();

		child.emit("exit", 1, null);

		await expect(running.done).resolves.toMatchObject({
			outcome: "failed",
			retryable: true,
		});
	});
});
