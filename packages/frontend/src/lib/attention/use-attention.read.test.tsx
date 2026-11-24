// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READ_EVERY_MS, useReadAdvance } from "./use-attention";

vi.mock("@/lib/api/orpc-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api/orpc-client")>();
	return {
		...actual,
		client: {
			...actual.client,
			attention: {
				...actual.client.attention,
				markThreadRead: vi.fn(),
			},
		},
	};
});

import { client } from "@/lib/api/orpc-client";

const mockedMarkThreadRead = vi.mocked(client.attention.markThreadRead);

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface AdvanceProps {
	id: string;
	lastOnScreen: string | null;
	ready: boolean;
}

function HookHarness({ props }: { props: AdvanceProps }) {
	useReadAdvance(props.id, props.lastOnScreen, props.ready);
	return null;
}

function renderHook(initialProps: AdvanceProps, queryClient: QueryClient) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	function render(props: AdvanceProps) {
		act(() => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<HookHarness props={props} />
				</QueryClientProvider>,
			);
		});
	}

	render(initialProps);

	return {
		rerender: (nextProps: AdvanceProps) => {
			render(nextProps);
		},
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("useReadAdvance and READ_EVERY_MS (#1181)", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient();
		mockedMarkThreadRead.mockResolvedValue({ advanced: true });
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			writable: true,
			configurable: true,
		});
		Object.defineProperty(document, "hidden", {
			value: false,
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first advance sends after the 800 ms debounce", () => {
		vi.useFakeTimers();
		const { unmount } = renderHook(
			{ id: "t1", lastOnScreen: "main:1", ready: true },
			queryClient,
		);

		act(() => {
			vi.advanceTimersByTime(799);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(0);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(1);
		expect(mockedMarkThreadRead).toHaveBeenCalledWith({
			id: "t1",
			key: "main:1",
		});

		unmount();
	});

	it("while lastOnScreen keeps changing, sends are at least READ_EVERY_MS apart and the send carries the latest key", () => {
		vi.useFakeTimers();
		const { rerender, unmount } = renderHook(
			{ id: "t1", lastOnScreen: "main:1", ready: true },
			queryClient,
		);

		// First send happens at t = 800 ms
		act(() => {
			vi.advanceTimersByTime(800);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(1);

		// Key changes multiple times while waiting
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		rerender({ id: "t1", lastOnScreen: "main:2", ready: true });

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		rerender({ id: "t1", lastOnScreen: "main:3", ready: true });

		act(() => {
			vi.advanceTimersByTime(3000);
		});
		rerender({ id: "t1", lastOnScreen: "main:4", ready: true });

		// Advance to 1 ms before READ_EVERY_MS has elapsed since first send (9999 ms total)
		act(() => {
			vi.advanceTimersByTime(3999);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(1);

		// Exactly READ_EVERY_MS after the first send, second send carries the latest key
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(2);
		expect(mockedMarkThreadRead).toHaveBeenLastCalledWith({
			id: "t1",
			key: "main:4",
		});

		unmount();
	});

	it("a hidden document sends nothing", () => {
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			value: "hidden",
			writable: true,
			configurable: true,
		});
		Object.defineProperty(document, "hidden", {
			value: true,
			writable: true,
			configurable: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));

		const { unmount } = renderHook(
			{ id: "t1", lastOnScreen: "main:1", ready: true },
			queryClient,
		);

		act(() => {
			vi.advanceTimersByTime(READ_EVERY_MS + 2000);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(0);

		unmount();
	});

	it("the same key is not sent twice", () => {
		vi.useFakeTimers();
		const { rerender, unmount } = renderHook(
			{ id: "t1", lastOnScreen: "main:1", ready: true },
			queryClient,
		);

		act(() => {
			vi.advanceTimersByTime(800);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(1);

		// Re-render with identical key
		rerender({ id: "t1", lastOnScreen: "main:1", ready: true });
		act(() => {
			vi.advanceTimersByTime(READ_EVERY_MS * 2);
		});
		expect(mockedMarkThreadRead).toHaveBeenCalledTimes(1);

		unmount();
	});
});
