// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalAvailability } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalStore } from "@/lib/terminal/store";
import { RunInTerminal } from "./RunInTerminal";
import { TerminalPanel } from "./TerminalPanel";

let availability: TerminalAvailability | undefined;
vi.mock("@/lib/terminal/use-terminal-availability", () => ({
	useTerminalAvailability: () => availability,
}));
vi.mock("./TerminalView", () => ({
	TerminalView: ({ tabId }: { tabId: number }) => (
		<div data-testid={`view-${tabId}`} />
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	for (const tab of terminalStore.get().tabs) terminalStore.closeTab(tab.id);
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe("TerminalPanel on a remote device", () => {
	it("explains that the terminal opens only on the host, and opens no shell", () => {
		availability = { available: false, reason: "not-host" };
		act(() => root.render(<TerminalPanel />));
		expect(q("terminal-not-host")?.textContent).toContain(
			"The terminal opens only on the host",
		);
		expect(container.querySelector("[data-testid^='view-']")).toBeNull();
		expect(terminalStore.get().tabs).toHaveLength(0);
		expect(container.querySelector("[aria-label='New terminal']")).toBeNull();
	});

	it("tells the host's other browser how to get a key", () => {
		availability = { available: false, reason: "no-key" };
		act(() => root.render(<TerminalPanel />));
		expect(q("terminal-no-key")?.textContent).toContain("pl pair --operator");
		expect(q("run-in-terminal")).toBeNull();
	});
});

describe("Run in terminal", () => {
	it("is hidden on a remote device even with a panel mounted", () => {
		availability = { available: false, reason: "not-host" };
		act(() =>
			root.render(
				<>
					<TerminalPanel />
					<RunInTerminal command="pl doctor" />
				</>,
			),
		);
		expect(q("run-in-terminal")).toBeNull();
	});

	it("is hidden on the host until the layout mounts a panel", () => {
		availability = { available: true };
		act(() => root.render(<RunInTerminal command="pl doctor" />));
		expect(q("run-in-terminal")).toBeNull();
	});

	it("is hidden for a command with control characters", () => {
		availability = { available: true };
		act(() =>
			root.render(
				<>
					<TerminalPanel />
					<RunInTerminal command={"ls\u000f"} />
				</>,
			),
		);
		expect(q("run-in-terminal")).toBeNull();
	});

	it("stages the command in a line under the shell; only Enter sends it", () => {
		availability = { available: true };
		act(() =>
			root.render(
				<>
					<TerminalPanel />
					<RunInTerminal command="pl doctor" />
				</>,
			),
		);
		const tab = terminalStore.get().active as number;
		const send = vi.fn(() => true);
		terminalStore.attachSender(tab, send);
		act(() => (q("run-in-terminal") as HTMLButtonElement).click());
		const input = q("terminal-draft")?.querySelector(
			"input",
		) as HTMLInputElement;
		expect(input.value).toBe("pl doctor");
		expect(send).not.toHaveBeenCalled();
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(send).toHaveBeenCalledWith({ t: "run", d: "pl doctor" });
		expect(q("terminal-draft")).toBeNull();
	});

	it("discards a staged command on Escape without sending it", () => {
		availability = { available: true };
		act(() =>
			root.render(
				<>
					<TerminalPanel />
					<RunInTerminal command="pl doctor" />
				</>,
			),
		);
		const send = vi.fn(() => true);
		terminalStore.attachSender(terminalStore.get().active as number, send);
		act(() => (q("run-in-terminal") as HTMLButtonElement).click());
		const input = q("terminal-draft")?.querySelector(
			"input",
		) as HTMLInputElement;
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(send).not.toHaveBeenCalled();
		expect(q("terminal-draft")).toBeNull();
	});
});
