// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessSettings } from "./HarnessSettings";

const mutateSpy = vi.fn();
const mutateAsyncSpy = vi.fn();

const mockHarnesses: HarnessStatus[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		binary: "claude",
		installed: true,
		tested: null,
		install: "",
		defaultModel: null,
		localDefault: { permission: null, mode: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		models: { source: "harness", asOf: "", entries: [] },
		checked: null,
	},
	{
		id: "codex",
		label: "Codex",
		binary: "codex",
		installed: false,
		tested: null,
		install: "npm i -g @openai/codex",
		defaultModel: null,
		localDefault: { permission: null, mode: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		models: { source: "harness", asOf: "", entries: [] },
		checked: null,
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		installed: false,
		tested: null,
		install: "npm i -g opencode",
		defaultModel: null,
		localDefault: { permission: null, mode: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		models: { source: "harness", asOf: "", entries: [] },
		checked: null,
	},
];

vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({
		data: {
			harnesses: mockHarnesses,
			selection: { harness: "claude-code" },
		},
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	}),
	useHarnessSettings: () => ({
		data: {
			harness: "claude-code",
		},
		isLoading: false,
	}),
	useUpdateHarnessSettings: () => ({
		mutate: mutateSpy,
		mutateAsync: mutateAsyncSpy,
		isPending: false,
		error: null,
	}),
	useCheckHarness: () => ({
		mutate: vi.fn(),
		mutateAsync: vi.fn(),
		isPending: false,
	}),
}));

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({
		effective: mockHarnesses[0],
		model: "",
		efforts: {},
		axes: {
			accessLevels: {},
			runModes: {},
			autoAccessLevels: {},
			autoRunModes: {},
		},
		setting: "claude-code",
		customModels: { "claude-code": ["gw-a"] },
		isLoading: false,
		isError: false,
	}),
	AgentModelPicker: () => <div data-testid="stub-agent-model-picker" />,
	EffortChip: () => <div data-testid="stub-effort-chip" />,
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
		mode: { mode: "execute", from: "prismalens" },
	}),
}));

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

// Pointer and layout APIs happy-dom lacks for Radix dialogs.
if (typeof Element.prototype.hasPointerCapture === "undefined") {
	Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === "undefined") {
	Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture === "undefined") {
	Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView === "undefined") {
	Element.prototype.scrollIntoView = () => {};
}

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mutateSpy.mockClear();
	mutateAsyncSpy.mockClear();
	mutateAsyncSpy.mockResolvedValue(undefined);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	for (const el of Array.from(
		document.body.querySelectorAll(
			'[data-float="dialog"], [data-float="scrim"]',
		),
	)) {
		el.parentElement?.remove();
	}
});

describe("HarnessSettings custom models (#673 w57)", () => {
	it("shows gw-a for installed claude-code and excludes uninstalled agents", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const claudeRow = container.querySelector(
			'[data-testid="custom-models-claude-code"]',
		);
		expect(claudeRow).not.toBeNull();
		expect(claudeRow?.textContent).toContain("gw-a");

		const codexRow = container.querySelector(
			'[data-testid="custom-models-codex"]',
		);
		expect(codexRow).toBeNull();
	});

	it("types ' gw-b ' and submits, calling mutate with trimmed list", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const input = container.querySelector(
			'[data-testid="custom-model-input"]',
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, " gw-b ");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const form = input?.closest("form");
		expect(form).not.toBeNull();

		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(mutateSpy).toHaveBeenCalledTimes(1);
		expect(mutateSpy).toHaveBeenCalledWith(
			{ customModels: { "claude-code": ["gw-a", "gw-b"] } },
			expect.anything(),
		);
	});

	it("submitting duplicate 'gw-a' sends nothing", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const input = container.querySelector(
			'[data-testid="custom-model-input"]',
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "gw-a");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const form = input?.closest("form");
		expect(form).not.toBeNull();

		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(mutateSpy).not.toHaveBeenCalled();
	});

	it("clicking remove opens dialog and cancel sends nothing", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const removeButton = container.querySelector(
			'[data-testid="custom-model-remove"]',
		) as HTMLButtonElement | null;
		expect(removeButton).not.toBeNull();

		await act(async () => {
			removeButton?.click();
		});

		const dialog = document.body.querySelector('[data-float="dialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog?.textContent).toContain("Remove this custom model?");

		const cancelButton = Array.from(
			document.body.querySelectorAll("button"),
		).find((b) => b.textContent?.trim() === "Cancel");
		expect(cancelButton).toBeDefined();

		await act(async () => {
			cancelButton?.click();
		});

		expect(mutateAsyncSpy).not.toHaveBeenCalled();
		expect(mutateSpy).not.toHaveBeenCalled();
	});

	it("clicking remove and confirming calls mutateAsync with model removed", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const removeButton = container.querySelector(
			'[data-testid="custom-model-remove"]',
		) as HTMLButtonElement | null;
		expect(removeButton).not.toBeNull();

		await act(async () => {
			removeButton?.click();
		});

		const confirmButton = Array.from(
			document.body.querySelectorAll("button"),
		).find((b) => b.textContent?.trim() === "Remove");
		expect(confirmButton).toBeDefined();

		await act(async () => {
			confirmButton?.click();
		});

		expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
		expect(mutateAsyncSpy).toHaveBeenCalledWith({
			customModels: { "claude-code": [] },
		});
	});
});

describe("HarnessSettings agent rows (#673 w21)", () => {
	it("the OpenCode row shows harness-opencode-asks with its rule, claude-code row does not", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const opencodeRow = container.querySelector(
			'[data-testid="harness-row-opencode"]',
		);
		expect(opencodeRow).not.toBeNull();
		const opencodeAsks = opencodeRow?.querySelector(
			'[data-testid="harness-opencode-asks"]',
		);
		expect(opencodeAsks).not.toBeNull();
		expect(opencodeAsks?.textContent?.replace(/\s+/g, " ").trim()).toBe(
			'A run sets each tool\'s "*" rule for its permission level; the other patterns in your opencode.json stay.',
		);

		const claudeRow = container.querySelector(
			'[data-testid="harness-row-claude-code"]',
		);
		expect(claudeRow).not.toBeNull();
		expect(
			claudeRow?.querySelector('[data-testid="harness-opencode-asks"]'),
		).toBeNull();
	});
});
