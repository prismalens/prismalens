// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetail, parseArgs } from "./AgentDetail";

const mutateSpy = vi.fn();
let mockSettings: Record<string, unknown> = { harness: "claude-code" };
const mutateAsyncSpy = vi.fn();

const mockHarnesses: HarnessStatus[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		binary: "claude",
		installed: true,
		runnable: true,
		tested: null,
		install: "",
		defaultModel: null,
		localDefault: { permission: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		cliBinary: "",
		configDir: null,
		providerKeys: [],
		envVars: [],
		models: { source: "harness", asOf: "", entries: [] },
		checked: null,
	},
	{
		id: "codex",
		label: "Codex",
		binary: "codex",
		installed: false,
		runnable: false,
		tested: null,
		install: "npm i -g @openai/codex",
		defaultModel: null,
		localDefault: { permission: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		cliBinary: "",
		configDir: null,
		providerKeys: [],
		envVars: [],
		models: { source: "harness", asOf: "", entries: [] },
		checked: null,
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		installed: false,
		runnable: false,
		tested: null,
		install: "npm i -g opencode",
		defaultModel: null,
		localDefault: { permission: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		cliBinary: "",
		configDir: null,
		providerKeys: [],
		envVars: [],
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
		data: mockSettings,
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

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		search,
		...rest
	}: {
		children: React.ReactNode;
		to: string;
		search?: Record<string, string>;
	}) => (
		<a href={`${to}?${new URLSearchParams(search).toString()}`} {...rest}>
			{children}
		</a>
	),
}));

let mockChoice = {
	effective: mockHarnesses[0],
	model: "",
	efforts: {} as Record<string, string | null>,
	axes: {
		accessLevels: {} as Partial<Record<HarnessId, AccessLevel>>,
	},
	setting: "claude-code",
	customModels: { "claude-code": ["gw-a"] } as Record<string, string[]>,
	hiddenModels: {} as Record<string, string[]>,
	modelOrder: {} as Record<string, string[]>,
	models: {} as Record<string, string>,
	isLoading: false,
	isError: false,
};

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => mockChoice,
	modelName: (_h: unknown, id: string) => id,
	agentCurrentModel: () => null,
	AgentModelPicker: () => <div data-testid="stub-agent-model-picker" />,
	EffortChip: () => <div data-testid="stub-effort-chip" />,
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
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
	mockChoice = {
		effective: mockHarnesses[0],
		model: "",
		efforts: {},
		axes: {
			accessLevels: {},
		},
		setting: "claude-code",
		customModels: { "claude-code": ["gw-a"] },
		hiddenModels: {},
		modelOrder: {},
		models: {},
		isLoading: false,
		isError: false,
	};
	mockSettings = { harness: "claude-code" };
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

describe("AgentDetail custom models (#673 w57, moved here by #907)", () => {
	it("lists gw-a as added by you", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});

		const row = container.querySelector('[data-testid="agent-model-gw-a"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain("Added by you");
	});

	it("types ' gw-b ' and submits, calling mutate with trimmed list", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
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

	it("submitting duplicate 'gw-a' sends nothing and says why", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
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
		expect(
			container.querySelector('[data-testid="custom-model-error"]')
				?.textContent,
		).toBe("gw-a is already in the list.");
	});

	it("clicking remove opens dialog and cancel sends nothing", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
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
			root.render(<AgentDetail id="claude-code" />);
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

const typeInto = async (input: HTMLInputElement | null, value: string) => {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input?.dispatchEvent(new Event("input", { bubbles: true }));
	});
};

describe("AgentDetail models (#907)", () => {
	it("hides a model, reorders it, and toggles all with one button", async () => {
		mockHarnesses[0].models = {
			source: "harness",
			asOf: "",
			entries: [
				{ id: "default", name: "Default (recommended)", status: null },
				{ id: "opus", name: "Opus", status: null },
				{ id: "sonnet", name: "Sonnet", status: null },
			],
		};
		try {
			await act(async () => {
				root.render(<AgentDetail id="claude-code" />);
			});
			expect(
				container.querySelector('[data-testid="agent-model-default"]'),
			).toBeNull();
			expect(
				container.querySelector('[data-testid="agent-models-count"]')
					?.textContent,
			).toBe("3 of 3 shown");
			const up = container.querySelector(
				'[aria-label="Move gw-a up"]',
			) as HTMLButtonElement;
			expect(up.disabled).toBe(true);
			await act(async () => {
				(
					container.querySelector(
						'[aria-label="Move sonnet up"]',
					) as HTMLButtonElement
				).click();
			});
			expect(mutateSpy).toHaveBeenLastCalledWith({
				modelOrder: { "claude-code": ["gw-a", "sonnet", "opus"] },
			});
			await act(async () => {
				(
					container.querySelector(
						'[aria-label="Show opus in the picker"]',
					) as HTMLButtonElement
				).click();
			});
			expect(mutateSpy).toHaveBeenLastCalledWith({
				hiddenModels: { "claude-code": ["opus"] },
			});
			const toggle = container.querySelector(
				'[data-testid="agent-models-toggle-all"]',
			) as HTMLButtonElement;
			expect(toggle.textContent).toBe("Hide all");
			await act(async () => toggle.click());
			expect(mutateSpy).toHaveBeenLastCalledWith({
				hiddenModels: { "claude-code": ["gw-a", "opus", "sonnet"] },
			});
			// One star per agent: the model a run uses with none picked (#907).
			expect(container.textContent).not.toContain("Default");
			await act(async () => {
				(
					container.querySelector(
						'[aria-label="Star sonnet"]',
					) as HTMLButtonElement
				).click();
			});
			expect(mutateSpy).toHaveBeenLastCalledWith({
				models: { "claude-code": "sonnet" },
			});
		} finally {
			mockHarnesses[0].models = { source: "harness", asOf: "", entries: [] };
		}
	});
});

describe("AgentDetail runtime and environment (#907)", () => {
	it("warns under a stored API key only that a signed-in agent may use its own credential (#935)", async () => {
		mockHarnesses[0].envVars = [
			{ name: "ANTHROPIC_API_KEY", state: "set" },
			{ name: "HTTPS_PROXY", state: "set" },
			{ name: "ANTHROPIC_AUTH_TOKEN", state: "env" },
		];
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const warned = (n: string) =>
			container.querySelector(
				`[data-testid="env-row-${n}"] [data-testid="env-signin-warning"]`,
			) !== null;
		expect(warned("ANTHROPIC_API_KEY")).toBe(true);
		expect(warned("HTTPS_PROXY")).toBe(false);
		expect(warned("ANTHROPIC_AUTH_TOKEN")).toBe(false);
		mockHarnesses[0].envVars = [];
	});

	it("names each variable Not set, Key set or From environment, never a value, and adds one as a password field", async () => {
		mockHarnesses[0].envVars = [
			{ name: "ANTHROPIC_API_KEY", state: "env" },
			{ name: "ANTHROPIC_AUTH_TOKEN", state: "unset" },
			{ name: "ANTHROPIC_BASE_URL", state: "set" },
		];
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const word = (n: string) =>
			container.querySelector(`[data-testid="env-state-${n}"]`)?.textContent;
		expect(word("ANTHROPIC_API_KEY")).toBe("From environment");
		expect(word("ANTHROPIC_AUTH_TOKEN")).toBe("Not set");
		expect(word("ANTHROPIC_BASE_URL")).toBe("Key set");
		// Only a stored value can be removed; the others offer Set.
		expect(
			container.querySelector(
				'[data-testid="env-row-ANTHROPIC_BASE_URL"] [data-testid="env-remove"]',
			),
		).not.toBeNull();
		await act(async () => {
			(
				container.querySelector(
					'[data-testid="env-row-ANTHROPIC_AUTH_TOKEN"] [data-testid="env-set"]',
				) as HTMLButtonElement
			).click();
		});
		expect(
			(container.querySelector('[data-testid="env-name"]') as HTMLInputElement)
				.value,
		).toBe("ANTHROPIC_AUTH_TOKEN");
		mockHarnesses[0].envVars = [];
		const value = container.querySelector(
			'[data-testid="env-value"]',
		) as HTMLInputElement;
		expect(value.type).toBe("password");
		// A name with no value can't be added; Remove is how a variable is cleared (#911).
		const addButton = () =>
			container.querySelector(
				'[data-testid="env-add-button"]',
			) as HTMLButtonElement;
		expect(addButton().disabled).toBe(true);
		expect(value.getAttribute("autocomplete")).toBe("off");
		await typeInto(
			container.querySelector('[data-testid="env-name"]'),
			"MY_KEY",
		);
		await typeInto(value, "s3cret");
		expect(addButton().disabled).toBe(false);
		await act(async () => {
			value
				.closest("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
		});
		expect(mutateSpy).toHaveBeenLastCalledWith(
			{ env: { "claude-code": { MY_KEY: "s3cret" } } },
			expect.anything(),
		);
	});

	it("saves a binary path on Enter", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const input = container.querySelector(
			'[data-testid="runtime-binary-input"]',
		) as HTMLInputElement;
		await typeInto(input, "/opt/claude/bin/claude");
		await act(async () => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(mutateSpy).toHaveBeenLastCalledWith(
			{ binaryPaths: { "claude-code": "/opt/claude/bin/claude" } },
			expect.anything(),
		);
	});

	it("reads runtime fields only, with the reason, on a paired device", async () => {
		mockSettings = { ...mockSettings, canEditRuntime: false };
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const input = container.querySelector(
			'[data-testid="runtime-binary-input"]',
		) as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(container.textContent).toContain(
			"Only this machine's own session can change what an agent runs.",
		);
		expect(container.querySelector('[data-testid="env-add"]')).toBeNull();
	});
});

describe("parseArgs", () => {
	it("splits quoted arguments and refuses shell operators", () => {
		expect(parseArgs('--acp --name "my agent" $HOME')).toEqual([
			"--acp",
			"--name",
			"my agent",
			"$HOME",
		]);
		expect(parseArgs("--acp | tee x")).toBe(
			"Arguments can't hold shell operators.",
		);
		expect(parseArgs("")).toEqual([]);
	});
});
