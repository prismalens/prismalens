// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StagedCommand } from "./StagedCommand";

const { stage, checkHarness, invalidate } = vi.hoisted(() => ({
	stage: vi.fn(),
	checkHarness: vi.fn(),
	invalidate: vi.fn(async () => {}),
}));
vi.mock("@tanstack/react-query", async (original) => ({
	...(await original<typeof import("@tanstack/react-query")>()),
	useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("@/lib/api/orpc-client", () => ({
	client: { settings: { harnesses: { checkHarness } } },
}));
vi.mock("@/lib/api/hooks", () => ({
	harnessKeys: { status: () => ["harnesses"] },
}));
vi.mock("@/lib/terminal/use-terminal-availability", () => ({
	useTerminalAvailability: () => ({ available: true }),
}));
vi.mock("@/lib/terminal/store", () => ({
	terminalStore: { stage },
	useTerminalState: (pick: (s: { hosts: number }) => unknown) =>
		pick({ hosts: 1 }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	document.body.innerHTML = "";
	vi.clearAllMocks();
});

async function render() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () =>
		root.render(
			<TooltipProvider>
				<StagedCommand
					agents={["claude-code", "codex"]}
					command="npm i -g example"
					label="Update all"
					testId="update"
					copyToo
				/>
			</TooltipProvider>,
		),
	);
	const q = (selector: string) => host.querySelector<HTMLElement>(selector);
	return { q, root };
}

describe("StagedCommand (#1180)", () => {
	it("the copy beside the button offers no terminal run of its own", async () => {
		const { q, root } = await render();
		expect(q('[data-testid="update-copy"]')?.textContent).toContain(
			"npm i -g example",
		);
		expect(q('[data-testid="run-in-terminal"]')).toBeNull();
		await act(async () => root.unmount());
	});

	it("refreshes the status once every check has settled, though one of them failed", async () => {
		let finish!: () => void;
		checkHarness.mockImplementation(({ id }: { id: string }) =>
			id === "codex"
				? Promise.reject(new Error("no answer"))
				: new Promise<void>((resolve) => {
						finish = resolve;
					}),
		);
		const { q, root } = await render();
		await act(async () => q('[data-testid="update"]')?.click());
		const [, { onEnd }] = stage.mock.calls[0] as [
			string,
			{ onEnd: () => void },
		];
		await act(async () => onEnd());
		expect(invalidate).not.toHaveBeenCalled();
		await act(async () => finish());
		expect(invalidate.mock.calls).toEqual([[{ queryKey: ["harnesses"] }]]);
		await act(async () => root.unmount());
	});
});
