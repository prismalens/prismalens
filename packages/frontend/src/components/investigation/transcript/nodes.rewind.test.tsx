// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { RewindRowsProvider, rewindNodes } from "./nodes.rewind";

// The first schema load fails as a dropped link does; later ones load for real.
const schemaLoad = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/lib/thread-schemas-load", async (load) => {
	const real = await load<typeof import("@/lib/thread-schemas-load")>();
	return {
		...real,
		loadThreadSchemas: () => {
			if (!schemaLoad.failNext) return real.loadThreadSchemas();
			schemaLoad.failNext = false;
			return Promise.reject(new Error("chunk failed"));
		},
	};
});

const ID = "11111111-1111-1111-1111-111111111111";
const RUN = "44444444-4444-4444-8444-444444444444";
const REWIND = "33333333-3333-3333-3333-333333333333";
const FROM_THREAD = "55555555-5555-4555-8555-555555555555";
const TS = "2026-11-26T05:00:00.000Z";

const base = (seq: number) => ({
	runId: RUN,
	branchId: "run",
	path: [],
	seq,
	ts: TS,
});
const said = (seq: number, text: string, more: object = {}) => ({
	kind: "operator_message",
	...base(seq),
	text,
	mode: "queue",
	delivered: true,
	...more,
});

const rewound = {
	kind: "thread_rewound",
	...base(20),
	rewindId: REWIND,
	fromSeq: 1,
	turns: 2,
	messageOrdinal: 1,
	throughOrdinal: 9,
	journals: {},
	reverted: [],
	kept: [],
	priorSessions: { agentSessions: null },
	session: "fork",
	by: { kind: "you" },
} as unknown as CanonicalEvent;

const Row = rewindNodes.thread_rewound.Node;
const rows = {
	threadId: ID,
	undoable: null,
	undone: new Set<string>(),
	restored: new Set<string>(),
	open: () => {},
};
const q = (testid: string) =>
	document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

async function showFolded(events: unknown[]) {
	await renderWithApp(
		<RewindRowsProvider value={rows}>
			<Row event={rewound} incidentId={null} />
		</RewindRowsProvider>,
		{ api: { "threads.rewindFolded": { events } } },
	);
	await act(async () => q("rewind-fold-show")?.click());
}

describe("a rewind's folded turns (#1193)", () => {
	it("offers Retry when the transcript's schemas fail to load, and Retry shows the turns", async () => {
		schemaLoad.failNext = true;
		await showFolded([said(1, "Use port 80")]);
		await vi.waitFor(() =>
			expect(q("rewind-folded-failed")?.textContent).toBe(
				"Couldn't read the folded turnsRetry",
			),
		);
		await act(async () => q("rewind-folded-retry")?.click());
		await vi.waitFor(
			() => expect(q("rewind-folded")?.textContent).toBe("You: Use port 80"),
			{ timeout: 10_000 },
		);
	});

	it("labels each folded message by who wrote it: you, another thread, or PrismaLens", async () => {
		await showFolded([
			said(1, "Use port 80"),
			{
				kind: "message_inbound",
				...base(2),
				messageId: FROM_THREAD,
				source: "thread",
				state: "delivered",
				arrivedAt: TS,
				from: { name: "Checkout fix" },
				text: "The tests pass now",
				line: "Checkout fix: The tests pass now",
			},
			said(3, "The tests pass now", { messageId: FROM_THREAD }),
			said(4, "Continue where you left off", {
				via: {
					harness: "claude-code",
					model: null,
					accessLevel: null,
					cause: "limit",
				},
			}),
			{ kind: "agent_step", ...base(5), text: "Done", toolCalls: [] },
		]);
		await vi.waitFor(() => expect(q("rewind-folded")).not.toBeNull(), {
			timeout: 10_000,
		});
		expect(
			[...document.querySelectorAll('[data-testid="rewind-folded"] li')].map(
				(li) => li.textContent,
			),
		).toEqual([
			"You: Use port 80",
			"Checkout fix: The tests pass now",
			"PrismaLens: Continue where you left off",
			"Agent: Done",
		]);
	});
});
