// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StagedCommand } from "./StagedCommand";

const { stage, checkHarness } = vi.hoisted(() => ({
	stage: vi.fn(),
	checkHarness: vi.fn(),
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

/** The harness status as the page reads it: each fetch answers the next version. */
let version = 0;
function Status() {
	const { data } = useQuery({
		queryKey: ["harnesses"],
		queryFn: async () => `status v${++version}`,
	});
	return <span data-testid="status">{data}</span>;
}

async function render() {
	version = 0;
	const client = new QueryClient();
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<TooltipProvider>
					<Status />
					<StagedCommand
						agents={["claude-code", "codex"]}
						command="npm i -g example"
						label="Update all"
						testId="update"
						copyToo
					/>
				</TooltipProvider>
			</QueryClientProvider>,
		),
	);
	const q = (selector: string) => host.querySelector<HTMLElement>(selector);
	const status = () => q('[data-testid="status"]')?.textContent;
	await vi.waitFor(() => {
		if (status() !== "status v1") throw new Error("status not read");
	});
	return { q, root, status };
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
		let codexRejected = false;
		checkHarness.mockImplementation(({ id }: { id: string }) => {
			if (id !== "codex")
				return new Promise<void>((resolve) => {
					finish = resolve;
				});
			codexRejected = true;
			return Promise.reject(new Error("no answer"));
		});
		const { q, root, status } = await render();
		await act(async () => q('[data-testid="update"]')?.click());
		const [, { onEnd }] = stage.mock.calls[0] as [
			string,
			{ onEnd: () => void },
		];
		await act(async () => onEnd());
		await act(() => new Promise((r) => setTimeout(r, 20)));
		expect(codexRejected).toBe(true);
		expect(status()).toBe("status v1");
		await act(async () => finish());
		await vi.waitFor(() => {
			if (status() !== "status v2") throw new Error("status not refreshed");
		});
		expect(status()).toBe("status v2");
		await act(async () => root.unmount());
	});
});
