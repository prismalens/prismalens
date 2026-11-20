// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenWith } from "./DetailsActions";
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
