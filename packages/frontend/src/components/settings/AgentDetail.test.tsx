// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { CustomModel, HarnessStatus } from "@prismalens/contracts";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetail, parseArgs } from "./AgentDetail";

const mutateSpy = vi.fn();
let mockSettings: Record<string, unknown> = { harness: "claude-code" };
let mockSelection: { harness?: string } = { harness: "claude-code" };
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
			selection: mockSelection,
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
	customModels: { "claude-code": ["gw-a"] } as Record<
		string,
		(string | CustomModel)[]
	>,
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
	mockSelection = { harness: "claude-code" };
	mockHarnesses[1].added = false;
	mockHarnesses[1].off = false;
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

describe("AgentDetail header (#911)", () => {
	it("carries the state word, the check's detail and OpenCode's permission note", async () => {
		await act(async () => {
			root.render(<AgentDetail id="opencode" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-state"]')
				?.textContent,
		).toBeTruthy();
		expect(
			container
				.querySelector('[data-testid="harness-opencode-asks"]')
				?.textContent?.replace(/\s+/g, " ")
				.trim(),
		).toBe(
			"A run sets each tool's default rule to match its permission level. Your other rules in opencode.json stay as they are.",
		);
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		expect(
			container.querySelector('[data-testid="harness-opencode-asks"]'),
		).toBeNull();
	});
});

describe("AgentDetail last check that did not answer (#1171)", () => {
	it("states the detail and the time in the line itself, with nothing to hover or focus", async () => {
		mockHarnesses[0].checked = {
			at: "2026-11-20T10:00:00.000Z",
			outcome: "answers-acp",
			detail: "answers ACP",
			version: null,
			companionVersion: null,
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: null,
			lastTry: {
				at: "2026-11-20T11:00:00.000Z",
				outcome: "no-answer",
				detail: "no answer in 10s",
			},
		};
		try {
			await act(async () => {
				root.render(<AgentDetail id="claude-code" />);
			});
			const line = container.querySelector(
				'[data-testid="agent-detail-last-try"]',
			);
			expect(line?.textContent).toContain("Last check timed out");
			expect(line?.textContent).toContain("no answer in 10s");
			expect(line?.hasAttribute("tabindex")).toBe(false);
		} finally {
			mockHarnesses[0].checked = null;
		}
	});
});

describe("AgentDetail runtime and environment (#907)", () => {
	it("says Overrides the environment only under a stored variable the host has too (#911)", async () => {
		mockHarnesses[0].envVars = [
			{ name: "ANTHROPIC_API_KEY", state: "set", inEnv: true },
			{ name: "ANTHROPIC_BASE_URL", state: "set", inEnv: false },
		];
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const overrides = (n: string) =>
			container.querySelector(
				`[data-testid="env-row-${n}"] [data-testid="env-overrides"]`,
			) !== null;
		expect(overrides("ANTHROPIC_API_KEY")).toBe(true);
		expect(overrides("ANTHROPIC_BASE_URL")).toBe(false);
		mockHarnesses[0].envVars = [];
	});

	it("warns under a stored API key only that a signed-in agent may use its own credential (#935)", async () => {
		// The note waits for a check that answered (#1171).
		mockHarnesses[0].checked = {
			at: "",
			outcome: "answers-acp",
			detail: "answers ACP",
			version: null,
			companionVersion: null,
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: null,
		};
		mockHarnesses[0].envVars = [
			{ name: "ANTHROPIC_API_KEY", state: "set", inEnv: false },
			{ name: "HTTPS_PROXY", state: "set", inEnv: false },
			{ name: "ANTHROPIC_AUTH_TOKEN", state: "env", inEnv: false },
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
		mockHarnesses[0].checked = null;
	});

	it("names each variable Not set, Key set or From environment, never a value, and adds one as a password field", async () => {
		mockHarnesses[0].envVars = [
			{ name: "ANTHROPIC_API_KEY", state: "env", inEnv: false },
			{ name: "ANTHROPIC_AUTH_TOKEN", state: "unset", inEnv: false },
			{ name: "ANTHROPIC_BASE_URL", state: "set", inEnv: false },
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
			"Only the owner can change what an agent runs.",
		);
		expect(container.querySelector('[data-testid="env-add"]')).toBeNull();
	});

	it("shows Remove from list only for added-only agents, and hides it when off, chosen, or binaryPath set (#1171)", async () => {
		mockHarnesses[1].added = true;
		mockHarnesses[1].off = false;
		mockSettings = { harness: "claude-code" };
		mockSelection = { harness: "claude-code" };

		await act(async () => {
			root.render(<AgentDetail id="codex" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-remove"]'),
		).not.toBeNull();

		mockHarnesses[1].off = true;
		await act(async () => {
			root.render(<AgentDetail id="codex" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-remove"]'),
		).toBeNull();

		mockHarnesses[1].off = false;
		mockSettings = { harness: "codex" };
		await act(async () => {
			root.render(<AgentDetail id="codex" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-remove"]'),
		).toBeNull();

		mockSettings = { harness: "claude-code" };
		mockSelection = { harness: "codex" };
		await act(async () => {
			root.render(<AgentDetail id="codex" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-remove"]'),
		).toBeNull();

		mockSelection = { harness: "claude-code" };
		mockSettings = {
			harness: "claude-code",
			binaryPaths: { codex: "/custom/codex" },
		};
		await act(async () => {
			root.render(<AgentDetail id="codex" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-remove"]'),
		).toBeNull();
	});

	it("toggling Use this agent switch PATCHes off (#1171)", async () => {
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const switchEl = container.querySelector(
			'[data-testid="agent-detail-on"]',
		) as HTMLButtonElement;
		expect(switchEl).not.toBeNull();
		await act(async () => {
			switchEl.click();
		});
		expect(mutateSpy).toHaveBeenCalledWith({
			off: { "claude-code": true },
		});
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

describe("AgentDetail: which agent runs next", () => {
	it("offers Use for new runs on a runnable agent that is not the setting, and sets the harness", async () => {
		mockHarnesses[2].runnable = true;
		mockHarnesses[2].installed = true;
		await act(async () => {
			root.render(<AgentDetail id="opencode" />);
		});
		const button = container.querySelector(
			'[data-testid="agent-detail-use-for-new-runs"]',
		) as HTMLButtonElement;
		expect(button.textContent).toBe("Use for new runs");
		expect(button.disabled).toBe(false);
		await act(async () => button.click());
		expect(mutateSpy).toHaveBeenCalledWith({ harness: "opencode" });
		mockHarnesses[2].runnable = false;
		mockHarnesses[2].installed = false;
	});

	it("reads In use, disabled, on the agent the setting names", async () => {
		mockHarnesses[0].runnable = true;
		await act(async () => {
			root.render(<AgentDetail id="claude-code" />);
		});
		const button = container.querySelector(
			'[data-testid="agent-detail-use-for-new-runs"]',
		) as HTMLButtonElement;
		expect(button.textContent).toBe("In use");
		expect(button.disabled).toBe(true);
	});

	it("names the providers an agent holds a login for as its account", async () => {
		mockHarnesses[2].checked = {
			outcome: "answers-acp",
			detail: "answers ACP",
			providers: ["Ollama Cloud", "Google"],
		} as HarnessStatus["checked"];
		await act(async () => {
			root.render(<AgentDetail id="opencode" />);
		});
		expect(
			container.querySelector('[data-testid="agent-detail-account"]')
				?.textContent,
		).toBe("Signed in to Ollama Cloud, Google");
		mockHarnesses[2].checked = null;
	});
});

describe("AgentDetail models: filter, favourites, names and labels (#1180)", () => {
	const listed = {
		source: "harness" as const,
		asOf: "",
		entries: [
			{ id: "opus", name: "Opus", status: null },
			{ id: "sonnet[1m]", name: "Sonnet", status: null },
		],
	};
	const rows = () =>
		Array.from(container.querySelectorAll('[data-testid^="agent-model-"]'))
			.map((el) => el.getAttribute("data-testid"))
			.filter((t) => /^agent-model-(?!add|star|show|fav|label)/.test(t ?? ""));

	it("Filter models narrows the rows by id; clearing it shows them all", async () => {
		mockHarnesses[0].models = listed;
		try {
			await act(async () => root.render(<AgentDetail id="claude-code" />));
			expect(rows()).toEqual([
				"agent-model-gw-a",
				"agent-model-opus",
				"agent-model-sonnet[1m]",
			]);
			const filter = container.querySelector(
				'[data-testid="agent-models-filter"]',
			) as HTMLInputElement;
			expect(filter.placeholder).toBe("Filter models");
			const type = async (v: string) =>
				act(async () => {
					const set = Object.getOwnPropertyDescriptor(
						HTMLInputElement.prototype,
						"value",
					)?.set;
					set?.call(filter, v);
					filter.dispatchEvent(new Event("input", { bubbles: true }));
				});
			await type("SONNET");
			expect(rows()).toEqual(["agent-model-sonnet[1m]"]);
			await type("");
			expect(rows()).toHaveLength(3);
		} finally {
			mockHarnesses[0].models = { source: "harness", asOf: "", entries: [] };
		}
	});

	it("Favourite adds to the list apart from the star and keeps other agents' favourites", async () => {
		mockHarnesses[0].models = listed;
		mockSettings = {
			harness: "claude-code",
			favourites: [{ harness: "codex", model: "gpt-6" }],
		};
		mockChoice.models = { "claude-code": "sonnet[1m]" };
		try {
			await act(async () => root.render(<AgentDetail id="claude-code" />));
			const fav = container.querySelector(
				'[aria-label="Favourite opus"]',
			) as HTMLButtonElement;
			expect(fav.getAttribute("aria-pressed")).toBe("false");
			await act(async () => fav.click());
			expect(mutateSpy).toHaveBeenCalledTimes(1);
			expect(mutateSpy).toHaveBeenLastCalledWith({
				favourites: [
					{ harness: "codex", model: "gpt-6" },
					{ harness: "claude-code", model: "opus" },
				],
			});
			// The star stays the default for this agent.
			expect(
				container
					.querySelector('[aria-label="Unstar sonnet[1m]"]')
					?.getAttribute("aria-pressed"),
			).toBe("true");
		} finally {
			mockHarnesses[0].models = { source: "harness", asOf: "", entries: [] };
		}
	});

	it("a custom model shows its own name and labels; a stored bare id still renders; a listed model shows none", async () => {
		mockHarnesses[0].models = listed;
		mockChoice.customModels = {
			"claude-code": [
				"gw-a",
				{ id: "gw-b", name: "Gateway B", labels: ["no-reasoning"] },
			],
		};
		try {
			await act(async () => root.render(<AgentDetail id="claude-code" />));
			const row = (id: string) =>
				container.querySelector(`[data-testid="agent-model-${id}"]`);
			expect(row("gw-a")?.textContent).toContain("gw-a");
			expect(row("gw-b")?.textContent).toContain("Gateway B");
			expect(
				row("gw-b")?.querySelector(
					'[data-testid="agent-model-label-no-reasoning"]',
				)?.textContent,
			).toBe("No reasoning");
			expect(
				row("sonnet[1m]")?.querySelector(
					'[data-testid="agent-model-label-large-context"]',
				)?.textContent,
			).toBe("1M context");
			expect(
				row("opus")?.querySelector('[data-mark="modelCapability"]'),
			).toBeNull();
		} finally {
			mockHarnesses[0].models = { source: "harness", asOf: "", entries: [] };
		}
	});
});
