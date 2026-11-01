// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalAvailability } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalStore } from "@/lib/terminal/store";
import type { RunStep } from "./run-steps";
import { StepCard } from "./StepCard";

let availability: TerminalAvailability | undefined;
vi.mock("@/lib/terminal/use-terminal-availability", () => ({
	useTerminalAvailability: () => availability,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let unhost: (() => void) | undefined;
beforeEach(() => {
	container = document.createElement("ul");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
	unhost?.();
	unhost = undefined;
});

const step = (over: Partial<RunStep> = {}): RunStep => ({
	n: 1,
	callId: "c1",
	title: "sed -n 1,80p worker/consumer.py",
	command: "sed -n 1,80p worker/consumer.py",
	kind: "command",
	shell: true,
	verb: "Ran",
	ok: true,
	unfinished: false,
	output: "import json",
	at: "",
	took: 0.2,
	input: null,
	...over,
});
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const render = (s: RunStep, open: boolean) =>
	act(() =>
		root.render(<StepCard step={s} open={open} onToggle={() => undefined} />),
	);

describe("A step's command (#931)", () => {
	it("offers Copy and Run in terminal in the expanded step, on the host with a terminal", () => {
		availability = { available: true };
		unhost = terminalStore.registerHost();
		render(step(), true);
		const chip = q("step-command");
		expect(chip?.textContent).toContain("sed -n 1,80p worker/consumer.py");
		expect(chip?.textContent).toContain("Copy");
		expect(chip?.querySelector("[data-testid=run-in-terminal]")).not.toBeNull();
	});

	it("keeps the collapsed row quiet", () => {
		availability = { available: true };
		unhost = terminalStore.registerHost();
		render(step(), false);
		expect(q("step-command")).toBeNull();
		expect(q("run-in-terminal")).toBeNull();
	});

	it("offers Copy alone where no terminal can open", () => {
		availability = { available: false, reason: "not-host" };
		unhost = terminalStore.registerHost();
		render(step(), true);
		expect(q("step-command")?.textContent).toContain("Copy");
		expect(q("run-in-terminal")).toBeNull();
	});

	it("gives a file read or a tool call no Run in terminal", () => {
		availability = { available: true };
		unhost = terminalStore.registerHost();
		render(step({ kind: "file", shell: false, command: "read a.py" }), true);
		expect(q("run-in-terminal")).toBeNull();
	});
});
