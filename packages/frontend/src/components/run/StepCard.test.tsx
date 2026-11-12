// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalAvailability } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
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
	// The app root provides tooltips; the step's terminal icon has a hint.
	const inner = createRoot(container);
	root = {
		render: (node) => inner.render(<TooltipProvider>{node}</TooltipProvider>),
		unmount: () => inner.unmount(),
	} as Root;
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

	it("shows repo/ but copies the command as it ran", async () => {
		availability = { available: true };
		unhost = terminalStore.registerHost();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		render(step({ command: "ls repo/api", run: "ls /ws/api" }), true);
		const chip = q("step-command");
		expect(chip?.querySelector("code")?.textContent).toBe("ls repo/api");
		const copy = Array.from(chip?.querySelectorAll("button") ?? []).find((b) =>
			b.textContent?.includes("Copy"),
		);
		await act(async () => copy?.click());
		expect(writeText).toHaveBeenCalledWith("ls /ws/api");
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

describe("A step's node on the spine (#1020)", () => {
	it("draws its node kind, and a PrismaLens tool's outcome line as plain text", () => {
		render(
			step({ node: "knowledge", outcome: "INC-7 <i>retry</i> storm" }),
			false,
		);
		expect(q("step")?.getAttribute("data-node")).toBe("knowledge");
		expect(q("step-outcome")?.textContent).toBe("INC-7 <i>retry</i> storm");
		expect(q("step-outcome")?.querySelector("i")).toBeNull();
	});

	it("falls back to its file or command kind when no node was derived", () => {
		render(step({ kind: "file" }), false);
		expect(q("step")?.getAttribute("data-node")).toBe("read");
		render(step(), false);
		expect(q("step")?.getAttribute("data-node")).toBe("command");
		expect(q("step-outcome")).toBeNull();
	});
});

describe("The PrismaLens data note (#1020)", () => {
	it("shows on the step that carries it, as plain text, and not on the others", () => {
		availability = undefined;
		render(step({ dataNote: true, outcome: "<b>No page</b>" }), false);
		expect(q("step-data-note")?.textContent).toMatch(/^PrismaLens data\./);
		expect(q("step-outcome")?.innerHTML).toBe("&lt;b&gt;No page&lt;/b&gt;");
		render(step({ outcome: "Done" }), false);
		expect(q("step-data-note")).toBeNull();
	});
});

describe("A PrismaLens tool's step header (#1020)", () => {
	it("names the tool in plain words and keeps the raw call in the details", () => {
		availability = undefined;
		render(
			step({
				title: "Searched for similar incidents",
				command: 'incidents_similar (prismalens-1)({"q":"x"})',
				gateway: true,
				shell: false,
			}),
			true,
		);
		const header = q("step")?.querySelector("button");
		expect(header?.textContent).toContain("Searched for similar incidents");
		expect(header?.textContent).not.toContain("incidents_similar");
		expect(q("step-body")?.textContent).toContain("incidents_similar");
	});

	it("leaves out the verb on a finished gateway step and keeps a failed one", () => {
		const gw = { title: "Read the incident", gateway: true, shell: false };
		render(step(gw), false);
		expect(q("step-verb")).toBeNull();
		render(step({ ...gw, ok: false, verb: "Failed" }), false);
		expect(q("step-verb")?.textContent).toBe("Failed");
	});
});
