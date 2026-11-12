// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ToolCall, ToolGroup, ToolLine } from "./ToolLine";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ToolLine", () => {
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

	it("renders a button with aria-expanded false when output is present, and clicking it sets true and shows output text in a pre", async () => {
		const call: ToolCall = {
			id: "call-1",
			verb: "Read",
			subject: "src/main.ts",
			output: "const answer = 42;",
		};

		await act(async () => {
			root.render(<ToolLine call={call} />);
		});

		const btn = container.querySelector<HTMLButtonElement>("button");
		expect(btn?.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector("pre")).toBeNull();

		await act(async () => {
			btn?.click();
		});

		expect(btn?.getAttribute("aria-expanded")).toBe("true");
		const pre = container.querySelector("pre");
		expect(pre?.textContent).toBe("const answer = 42;");
	});

	it("renders no button for a call without output", async () => {
		const call: ToolCall = {
			id: "call-2",
			verb: "Read",
			subject: "src/empty.ts",
		};

		await act(async () => {
			root.render(<ToolLine call={call} />);
		});

		expect(container.querySelector("button")).toBeNull();
	});

	it("renders failed text", async () => {
		const call: ToolCall = {
			id: "call-3",
			verb: "Ran",
			subject: "pnpm test",
			failed: "Process failed with exit code 1",
		};

		await act(async () => {
			root.render(<ToolLine call={call} />);
		});

		const toolLine = container.querySelector('[data-testid="tool-line"]');
		expect(toolLine?.textContent).toContain("Process failed with exit code 1");
	});
});

describe("ToolGroup", () => {
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

	it("shows the summary with its first letter upper-cased for 2 calls, and opening it renders 2 tool-line elements", async () => {
		const calls: ToolCall[] = [
			{ id: "c1", verb: "Ran", subject: "git status" },
			{ id: "c2", verb: "Ran", subject: "git diff" },
		];

		await act(async () => {
			root.render(<ToolGroup summary="ran 2 commands" calls={calls} />);
		});

		const group = container.querySelector('[data-testid="tool-group"]');
		expect(group?.textContent).toContain("Ran 2 commands");
		expect(
			container.querySelectorAll('[data-testid="tool-line"]'),
		).toHaveLength(0);

		const btn = group?.querySelector<HTMLButtonElement>("button");
		await act(async () => {
			btn?.click();
		});

		expect(
			container.querySelectorAll('[data-testid="tool-line"]'),
		).toHaveLength(2);
	});

	it("renders a tool-line and no tool-group for 1 call", async () => {
		const calls: ToolCall[] = [
			{ id: "c1", verb: "Ran", subject: "git status" },
		];

		await act(async () => {
			root.render(<ToolGroup summary="ran 1 command" calls={calls} />);
		});

		expect(container.querySelector('[data-testid="tool-line"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="tool-group"]')).toBeNull();
	});
});
