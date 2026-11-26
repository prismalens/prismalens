// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteIn, QuotePicker } from "./QuoteIn";
import { lazyQuoteIn } from "./QuoteInPart";

const feed = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useThreadFeed: () => ({
		data: undefined,
		isPending: false,
		isError: true,
		refetch: feed.refetch,
	}),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const settle = () =>
	act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});

describe("the Quote in another thread picker (#1195)", () => {
	it("says the thread list did not load, offers Retry, and keeps New thread", async () => {
		const onRetry = vi.fn();
		const onNew = vi.fn();
		await act(async () =>
			root.render(
				<QuotePicker
					threads={[]}
					loading={false}
					failed
					onRetry={onRetry}
					query=""
					onQuery={vi.fn()}
					onNew={onNew}
					onPick={vi.fn()}
				/>,
			),
		);
		expect(q("state-problem")?.textContent).toBe("Threads did not load.Retry");
		expect(q("quote-in-new")?.textContent).toBe("New thread");
		await act(async () => {
			q("state-problem")?.querySelector("button")?.click();
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("shows a failed thread-feed request in the open picker, and Retry asks the feed again", async () => {
		await act(async () =>
			root.render(
				<QuoteIn
					chip={{
						key: "k",
						quote: {
							source: {
								threadId: "22222222-2222-4222-8222-222222222222",
								kind: "transcript",
							},
							text: "quoted",
						},
						cut: false,
					}}
					from="11111111-1111-4111-8111-111111111111"
					onNewThread={vi.fn()}
					onClose={vi.fn()}
				/>,
			),
		);
		expect(q("state-problem")?.textContent).toBe("Threads did not load.Retry");
		await act(async () => {
			q("state-problem")?.querySelector("button")?.click();
		});
		expect(feed.refetch).toHaveBeenCalledTimes(1);
	});

	it("shows no failure while the list loads or when it loaded", async () => {
		const picker = (
			loading: boolean,
			threads: { id: string; title: string; kind: string }[],
		) => (
			<QuotePicker
				threads={threads}
				loading={loading}
				query=""
				onQuery={vi.fn()}
				onNew={vi.fn()}
				onPick={vi.fn()}
			/>
		);
		await act(async () => root.render(picker(true, [])));
		expect(q("state-problem")).toBeNull();
		expect(q("quote-in-thread")).toBeNull();
		expect(q("quote-in-new")?.textContent).toBe("New thread");

		await act(async () =>
			root.render(
				picker(false, [{ id: "t1", title: "Pool size review", kind: "chat" }]),
			),
		);
		expect(q("state-problem")).toBeNull();
		expect(q("quote-in-thread")?.textContent).toBe("Pool size review");
	});
});

describe("the picker's code loading (#1195)", () => {
	const props = {
		chip: null,
		from: "11111111-1111-4111-8111-111111111111",
		onNewThread: vi.fn(),
		onClose: vi.fn(),
	};

	it("shows loading while its code loads, then the picker", async () => {
		let arrive!: () => void;
		const arrived = new Promise<void>((r) => {
			arrive = r;
		});
		const Part = lazyQuoteIn(async () => {
			await arrived;
			return () => <p data-testid="picker-loaded">picker</p>;
		});
		await act(async () => root.render(<Part {...props} />));
		expect(q("state-loading")).not.toBeNull();
		expect(q("picker-loaded")).toBeNull();
		await act(async () => {
			arrive();
			await arrived;
		});
		await settle();
		expect(q("state-loading")).toBeNull();
		expect(q("picker-loaded")?.textContent).toBe("picker");
	});

	it("says it did not load when its code fails, and Retry loads it again; Dismiss closes it", async () => {
		const load = vi
			.fn<() => Promise<typeof QuoteIn>>()
			.mockRejectedValueOnce(new Error("chunk"))
			.mockResolvedValue((() => (
				<p data-testid="picker-loaded">picker</p>
			)) as typeof QuoteIn);
		const onClose = vi.fn();
		const Part = lazyQuoteIn(load);
		await act(async () => root.render(<Part {...props} onClose={onClose} />));
		await settle();
		expect(q("state-problem")?.textContent).toBe(
			"Quote picker did not load.RetryDismiss",
		);
		await act(async () => {
			(
				q("state-problem")?.querySelectorAll("button")[1] as HTMLButtonElement
			)?.click();
		});
		expect(onClose).toHaveBeenCalledTimes(1);
		await act(async () => {
			(
				q("state-problem")?.querySelectorAll("button")[0] as HTMLButtonElement
			)?.click();
		});
		await settle();
		expect(q("state-problem")).toBeNull();
		expect(q("picker-loaded")?.textContent).toBe("picker");
		expect(load).toHaveBeenCalledTimes(2);
	});
});
