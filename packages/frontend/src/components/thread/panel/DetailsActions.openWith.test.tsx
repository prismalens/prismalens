// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailsFolder, useOpenWith } from "./DetailsActions";
import "./details.actions";
import "./details.surface";
import type { DetailsCtx, EditorChoice } from "./details.actions";

const h = vi.hoisted(() => ({
	update: vi.fn(),
	editors: vi.fn(),
	settings: vi.fn(),
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		settings: {
			editors: {
				list: {
					queryOptions: () => ({
						queryKey: ["editors"],
						queryFn: () => h.editors(),
					}),
				},
			},
			threadContext: {
				get: {
					queryKey: () => ["threadContext"],
					queryOptions: () => ({
						queryKey: ["threadContext"],
						queryFn: () => h.settings(),
					}),
				},
				update: { call: h.update },
			},
		},
	},
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseCtx: DetailsCtx = {
	branch: "fix/a",
	host: "github",
	ask: vi.fn(),
	openPr: vi.fn(),
	openFolder: vi.fn(),
	openTerminal: vi.fn(),
	facts: { is: { folder: true } },
};

function Harness({
	open,
	result,
}: {
	open: (e?: EditorChoice) => void;
	result: { current: DetailsCtx };
}) {
	result.current = useOpenWith(baseCtx, { os: "linux", owner: true, open });
	return null;
}

function mount(open: (e?: EditorChoice) => void) {
	const result = { current: undefined as unknown as DetailsCtx };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(document.createElement("div"));
	return {
		result,
		client,
		render: () =>
			act(async () => {
				root.render(
					<QueryClientProvider client={client}>
						<Harness open={open} result={result} />
					</QueryClientProvider>,
				);
			}),
	};
}

const defer = () => {
	let resolve!: (v: unknown) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
};

/** Lets both reads land and the hook re-render with them. */
const settle = () =>
	act(async () => {
		await new Promise((r) => setTimeout(r, 25));
	});

beforeEach(() => {
	h.update.mockReset();
	h.editors.mockReset().mockResolvedValue({
		editors: [
			{ id: "vscode", label: "VS Code" },
			{ id: "cursor", label: "Cursor" },
		],
	});
	h.settings.mockReset().mockResolvedValue({ editor: "system", keep: 1 });
});

describe("useOpenWith default saves (#1176)", () => {
	it("lets the latest pick win when an earlier save fails while a later one is queued", async () => {
		const first = defer();
		const second = defer();
		const third = defer();
		h.update
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise)
			.mockReturnValueOnce(third.promise);
		const { result, render } = mount(vi.fn());
		await render();
		await settle();

		await act(async () => {
			result.current.openIn?.("vscode");
			result.current.openIn?.("cursor");
		});
		await act(async () => {
			first.reject(new Error("save failed"));
		});
		// Back to the saved default while the Cursor save is still queued or in flight.
		await act(async () => {
			result.current.openIn?.("system");
		});
		await act(async () => {
			second.resolve({ editor: "cursor", keep: 1 });
			third.resolve({ editor: "system", keep: 1 });
		});

		expect(h.update.mock.calls.map(([body]) => body.editor)).toEqual([
			"vscode",
			"cursor",
			"system",
		]);
	});
});

describe("useOpenWith saves read the cache (#1176)", () => {
	it("sends the settings as the cache holds them when the save goes out", async () => {
		const first = defer();
		h.update
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue({ editor: "cursor", keep: 2 });
		const { result, render } = mount(vi.fn());
		await render();
		await settle();

		await act(async () => {
			result.current.openIn?.("vscode");
			result.current.openIn?.("cursor");
		});
		await act(async () => {
			first.resolve({ editor: "vscode", keep: 2 });
		});
		await settle();

		// `keep` changed after the second pick was made; the second save carries it.
		expect(h.update.mock.calls[1]?.[0]).toEqual({ editor: "cursor", keep: 2 });
	});

	it("lets a completed pick be made again once the default was changed elsewhere", async () => {
		h.update.mockImplementation(async (body) => body);
		const { result, client, render } = mount(vi.fn());
		await render();
		await settle();

		await act(async () => {
			result.current.openIn?.("vscode");
		});
		await settle();
		// Another tab sets Cursor; the refreshed default reaches this one.
		await act(async () => {
			client.setQueryData(["threadContext"], { editor: "cursor", keep: 1 });
		});
		await settle();
		await act(async () => {
			result.current.openIn?.("vscode");
		});
		await settle();

		expect(h.update.mock.calls.map(([body]) => body.editor)).toEqual([
			"vscode",
			"vscode",
		]);
	});
});

describe("useOpenWith folder button (#1176)", () => {
	it("lets the host pick its saved default while a read is pending", async () => {
		h.settings.mockReturnValue(new Promise(() => {}));
		const open = vi.fn<(e?: EditorChoice) => void>();
		const { result, render } = mount(open);
		await render();
		result.current.openFolder();
		expect(open).toHaveBeenCalledWith();
	});

	it("lets the host pick its saved default when a read failed, not the file manager", async () => {
		h.settings.mockRejectedValue(new Error("no settings"));
		const open = vi.fn<(e?: EditorChoice) => void>();
		const { result, render } = mount(open);
		await render();
		await settle();
		result.current.openFolder();
		expect(open).toHaveBeenCalledWith();
	});

	it("falls back to the file manager once both reads finish and the saved editor is gone", async () => {
		h.settings.mockResolvedValue({ editor: "zed" });
		const open = vi.fn<(e?: EditorChoice) => void>();
		const { result, render } = mount(open);
		await render();
		await settle();
		result.current.openFolder();
		expect(open).toHaveBeenCalledWith("system");
	});
});

describe("the folder split names no provisional default (#1176)", () => {
	const folderButton = (c: HTMLElement) =>
		c.querySelector<HTMLButtonElement>('[data-testid="details-open-folder"]');

	const openWith = (c: HTMLElement) =>
		c.querySelector<HTMLButtonElement>('[data-testid="details-open-with"]');

	/** Inside a place row that leaves the name no slack, so the split folds to one control. */
	async function renderNarrow() {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<TooltipProvider>
						<div data-testid="details-place">
							<div>
								<span data-testid="details-place-name" />
							</div>
							<DetailsFolder
								ctx={{
									...baseCtx,
									facts: { is: { folder: true, terminal: true } },
									opener: { os: "linux", owner: true, open: vi.fn() },
								}}
							/>
						</div>
					</TooltipProvider>
				</QueryClientProvider>,
			);
		});
		return container;
	}

	async function renderSplit() {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<TooltipProvider>
						<DetailsFolder
							ctx={{
								...baseCtx,
								opener: { os: "linux", owner: true, open: vi.fn() },
							}}
						/>
					</TooltipProvider>
				</QueryClientProvider>,
			);
		});
		return container;
	}

	it("says 'Open folder', not Files, while a read is pending", async () => {
		h.settings.mockReturnValue(new Promise(() => {}));
		const container = await renderSplit();
		expect(folderButton(container)?.getAttribute("aria-label")).toBe(
			"Open folder",
		);
		// The button shows it is still reading, with no editor named.
		expect(folderButton(container)?.getAttribute("data-read")).toBe("loading");
		expect(folderButton(container)?.getAttribute("aria-busy")).toBe("true");
	});

	it("says 'Open folder', not Files, when a read failed", async () => {
		h.editors.mockRejectedValue(new Error("no editors"));
		const container = await renderSplit();
		await settle();
		expect(folderButton(container)?.getAttribute("aria-label")).toBe(
			"Open folder",
		);
		expect(folderButton(container)?.getAttribute("data-read")).toBe("failed");
		expect(folderButton(container)?.getAttribute("aria-busy")).toBe("false");
	});

	it("shows the failed state when only the saved default could not be read", async () => {
		h.settings.mockRejectedValue(new Error("no settings"));
		const container = await renderSplit();
		await settle();
		expect(folderButton(container)?.getAttribute("data-read")).toBe("failed");
	});

	it("names the saved editor once both reads land", async () => {
		h.settings.mockResolvedValue({ editor: "vscode" });
		const container = await renderSplit();
		await settle();
		expect(folderButton(container)?.getAttribute("aria-label")).toBe(
			"Open in VS Code",
		);
		expect(folderButton(container)?.hasAttribute("data-read")).toBe(false);
	});

	it("shows a pending read on the folded control, with no expanded button", async () => {
		h.settings.mockReturnValue(new Promise(() => {}));
		const container = await renderNarrow();
		expect(folderButton(container)).toBeNull();
		expect(openWith(container)?.getAttribute("data-read")).toBe("loading");
		expect(openWith(container)?.getAttribute("aria-busy")).toBe("true");
		expect(openWith(container)?.getAttribute("aria-label")).toContain(
			"Reading editors",
		);
	});

	it("shows a failed read on the folded control", async () => {
		h.editors.mockRejectedValue(new Error("no editors"));
		const container = await renderNarrow();
		await settle();
		expect(folderButton(container)).toBeNull();
		expect(openWith(container)?.getAttribute("data-read")).toBe("failed");
		expect(openWith(container)?.getAttribute("aria-busy")).toBe("false");
		expect(openWith(container)?.getAttribute("aria-label")).toContain(
			"Editors unavailable",
		);
	});

	it("names the saved editor on the folded control once both reads land", async () => {
		h.settings.mockResolvedValue({ editor: "vscode" });
		const container = await renderNarrow();
		await settle();
		expect(openWith(container)?.getAttribute("aria-label")).toBe(
			"Open with (VS Code by default)",
		);
		expect(openWith(container)?.hasAttribute("data-read")).toBe(false);
	});

	it("opens the menu from the folded control while a hint is showing", async () => {
		h.settings.mockReturnValue(new Promise(() => {}));
		const container = await renderNarrow();
		const button = openWith(container);
		expect(button?.getAttribute("aria-haspopup")).toBe("menu");
		await act(async () => {
			button?.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					ctrlKey: false,
				}),
			);
		});
		await settle();
		expect(openWith(container)?.getAttribute("aria-expanded")).toBe("true");
	});
});
