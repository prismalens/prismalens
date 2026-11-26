// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadCitations } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CitationsProvider, CitedIn } from "./citations";

const load = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		references: {
			citations: {
				queryOptions: ({ input }: { input: { threadId: string } }) => ({
					queryKey: ["citations", input.threadId],
					queryFn: () => load.fn(),
				}),
			},
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const THREAD = "11111111-1111-4111-8111-111111111111";
const citing: ThreadCitations = {
	cites: [],
	citedIn: [
		{
			threadId: "22222222-2222-4222-8222-222222222222",
			title: "Follow-up",
			key: "main:3",
			turn: 2,
			at: "2026-11-12T08:00:00.000Z",
		},
	],
};

describe("the citations a thread page reads (#1195)", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		load.fn.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	const show = () =>
		act(async () =>
			root.render(
				<QueryClientProvider
					client={
						new QueryClient({ defaultOptions: { queries: { retry: false } } })
					}
				>
					<CitationsProvider threadId={THREAD}>
						<CitedIn eventKey="main:3" />
					</CitationsProvider>
				</QueryClientProvider>,
			),
		);
	const settle = () =>
		act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
	const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

	it("says so, with Retry, when the request fails, and shows the citing thread once it succeeds", async () => {
		load.fn
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(citing);
		await show();
		await settle();
		expect(q("state-problem")?.textContent).toBe(
			"Citations did not load.Retry",
		);
		expect(q("transcript-cited-in")).toBeNull();

		await act(async () => {
			q("state-problem")?.querySelector("button")?.click();
		});
		await settle();
		expect(q("state-problem")).toBeNull();
		expect(q("transcript-cited-in")?.textContent).toBe("Cited in Follow-up");
		expect(load.fn).toHaveBeenCalledTimes(2);
	});

	it("stays quiet when the thread has no citations", async () => {
		load.fn.mockResolvedValue({ cites: [], citedIn: [] });
		await show();
		await settle();
		expect(q("state-problem")).toBeNull();
		expect(q("transcript-cited-in")).toBeNull();
		expect(load.fn).toHaveBeenCalledTimes(1);
	});
});
