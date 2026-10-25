// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessSettings, testedHint, versionText } from "./HarnessSettings";

const mutateSpy = vi.fn();
const mockSelection: { harness: string | null } = { harness: "claude-code" };
const mockSettings: Record<string, unknown> = { harness: "claude-code" };
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
		installed: true,
		runnable: true,
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
	customModels: { "claude-code": ["gw-a"] } as Record<string, string[]>,
	isLoading: false,
	isError: false,
};

vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => mockChoice,
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
		isLoading: false,
		isError: false,
	};
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

describe("HarnessSettings agents list (#907)", () => {
	it("lists only agents that can run, each with a chevron to its page", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});
		expect(
			container.querySelector('[data-testid="harness-row-claude-code"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="harness-row-codex"]'),
		).toBeNull();
		expect(container.textContent).not.toContain("not installed");
		const link = container.querySelector(
			'[data-testid="harness-open-claude-code"]',
		);
		expect(link?.getAttribute("href")).toBe(
			"/settings?tab=agent&agent=claude-code",
		);
		expect(
			container.querySelector('[data-testid="harness-custom-models"]'),
		).toBeNull();
	});

	it("shows the one warning when no agent can run", async () => {
		const saved = mockHarnesses.map((h) => h.runnable);
		for (const h of mockHarnesses) h.runnable = false;
		mockSelection.harness = null;
		mockSettings.harness = "auto";
		try {
			await act(async () => {
				root.render(<HarnessSettings />);
			});
			expect(
				container.querySelector('[data-testid="harness-none-available"]')
					?.textContent,
			).toBe("No agent can run. Add one to start investigations.");
			expect(
				container.querySelector('[data-testid^="harness-row-"]'),
			).toBeNull();
		} finally {
			mockHarnesses.forEach((h, i) => {
				h.runnable = saved[i] ?? false;
			});
			mockSelection.harness = "claude-code";
			mockSettings.harness = "claude-code";
		}
	});

	it("keeps the saved agent listed when it can't run", async () => {
		const saved = mockHarnesses[0].runnable;
		mockHarnesses[0].runnable = false;
		try {
			await act(async () => {
				root.render(<HarnessSettings />);
			});
			expect(
				container.querySelector('[data-testid="harness-row-claude-code"]'),
			).not.toBeNull();
		} finally {
			mockHarnesses[0].runnable = saved;
		}
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
			"A run sets each tool's default rule to match its permission level. Your other rules in opencode.json stay as they are.",
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

describe("HarnessSettings signed-out row (w8-9)", () => {
	it("says the picker's sentence when the last check needs a sign-in", async () => {
		const saved = mockHarnesses[0].checked;
		mockHarnesses[0].checked = {
			at: "",
			outcome: "sign-in-needed",
			detail: "sign in needed",
			version: null,
			companionVersion: null,
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: null,
		};
		try {
			await act(async () => {
				root.render(<HarnessSettings />);
			});
			expect(
				container.querySelector(
					'[data-testid="harness-check-result-claude-code"]',
				)?.textContent,
			).toBe(
				"Claude Code is not signed in to its model provider. Sign in with its own CLI, then retry.",
			);
		} finally {
			mockHarnesses[0].checked = saved;
		}
	});
});

describe("HarnessSettings Permission rows (#673 w21)", () => {
	it("renders the Next run Permission select and no Mode row", async () => {
		await act(async () => {
			root.render(<HarnessSettings />);
		});

		expect(
			container.querySelector('[data-testid="harness-run-mode"]'),
		).toBeNull();

		const accessRow = container.querySelector('[data-testid="harness-access"]');
		expect(accessRow).not.toBeNull();
		expect(accessRow?.textContent).toContain("Permission");
		expect(accessRow?.textContent).toContain("Ask always, PrismaLens's pick.");

		// Verify Claude Code agent note is displayed
		const note = container.querySelector('[data-testid="harness-agent-note"]');
		expect(note).not.toBeNull();
		expect(note?.textContent).toContain(
			"Your ~/.claude/settings.json allow and deny rules",
		);

		// Verify alert runs line is displayed
		const alertRunsLine = container.querySelector(
			'[data-testid="harness-alert-runs"]',
		);
		expect(alertRunsLine).not.toBeNull();
		expect(alertRunsLine?.textContent).toContain(
			"Runs an alert starts don't use this: nobody is there to answer, so they run at Auto and refuse anything they would ask you.",
		);

		// Select elements exist
		const accessSelect = container.querySelector(
			'[data-testid="harness-access-select"]',
		);
		expect(accessSelect).not.toBeNull();
	});

	it("renders set here line when accessLevels is set in settings", async () => {
		mockChoice = {
			...mockChoice,
			axes: {
				accessLevels: { "claude-code": "auto" },
			},
		};

		await act(async () => {
			root.render(<HarnessSettings />);
		});

		const accessRow = container.querySelector('[data-testid="harness-access"]');
		expect(accessRow?.textContent).toContain("Auto, set here.");
	});
});

describe("versionText", () => {
	it("returns '1.18.32, tested with 1.18.30' when checked.version differs from tested.version", () => {
		const h = {
			...mockHarnesses[0],
			checked: {
				at: "",
				outcome: "answers-acp" as const,
				detail: "",
				version: "1.18.32",
				companionVersion: null,
				servedModel: null,
				effort: null,
				modes: [],
				efforts: [],
				images: false,
				sandbox: null,
			},
			tested: { version: "1.18.30", date: "2026-10-01" },
		};
		expect(versionText(h)).toBe("1.18.32, tested with 1.18.30");
	});

	it("returns '1.18.30, tested with 1.18.30' when equal (#831 w6-4)", () => {
		const h = {
			...mockHarnesses[0],
			checked: {
				at: "",
				outcome: "answers-acp" as const,
				detail: "",
				version: "1.18.30",
				companionVersion: null,
				servedModel: null,
				effort: null,
				modes: [],
				efforts: [],
				images: false,
				sandbox: null,
			},
			tested: { version: "1.18.30", date: "2026-10-01" },
		};
		expect(versionText(h)).toBe("1.18.30, tested with 1.18.30");
	});

	it("returns 'tested with 1.18.30' with no check", () => {
		const h = {
			...mockHarnesses[0],
			checked: null,
			tested: { version: "1.18.30", date: "2026-10-01" },
		};
		expect(versionText(h)).toBe("tested with 1.18.30");
	});

	it("returns '2.1.296, tested with 2.1.296' when checked.companionVersion is 2.1.296 and tested.companion is 2.1.296", () => {
		const h = {
			...mockHarnesses[0],
			checked: {
				at: "",
				outcome: "answers-acp" as const,
				detail: "",
				version: "0.81.1",
				companionVersion: "2.1.296",
				servedModel: null,
				effort: null,
				modes: [],
				efforts: [],
				images: false,
				sandbox: null,
			},
			tested: { version: "0.81.1", date: "2026-10-11", companion: "2.1.296" },
		};
		expect(versionText(h)).toBe("2.1.296, tested with 2.1.296");
	});

	it("names the adapter's tested version when no CLI version was tested (#831 w6-3)", () => {
		const h = {
			...mockHarnesses[0],
			label: "Codex",
			checked: {
				at: "",
				outcome: "answers-acp" as const,
				detail: "",
				version: "1.13.1",
				companionVersion: "0.162.1",
				servedModel: null,
				effort: null,
				modes: [],
				efforts: [],
				images: false,
				sandbox: null,
			},
			tested: { version: "1.13.1", date: "2026-09-24" },
		};
		expect(versionText(h)).toBe("0.162.1, adapter tested with 1.13.1");
		expect(testedHint(h)).toBe("PrismaLens was tested with its adapter 1.13.1");
		expect(
			testedHint({
				...h,
				label: "Claude Code",
				tested: { version: "0.81.1", date: "2026-10-11", companion: "2.1.296" },
			}),
		).toBe(
			"PrismaLens was tested with Claude Code 2.1.296 through its adapter 0.81.1",
		);
	});

	it("keeps the adapter wording when the check needed a sign-in (w8-8)", () => {
		const h = {
			...mockHarnesses[0],
			label: "Codex",
			checked: {
				at: "",
				outcome: "sign-in-needed" as const,
				detail: "sign in needed (API Key, ChatGPT)",
				version: null,
				companionVersion: "0.162.1",
				servedModel: null,
				effort: null,
				modes: null,
				efforts: null,
				images: false,
				sandbox: null,
			},
			tested: { version: "1.13.1", date: "2026-09-24" },
		};
		expect(versionText(h)).toBe("0.162.1, adapter tested with 1.13.1");
	});

	it("names the tested CLI, not the adapter, before any check (w8-8)", () => {
		const h = {
			...mockHarnesses[0],
			checked: null,
			tested: { version: "0.81.1", date: "2026-10-11", companion: "2.1.296" },
		};
		expect(versionText(h)).toBe("tested with 2.1.296");
	});

	it("returns null with neither", () => {
		const h = {
			...mockHarnesses[0],
			checked: null,
			tested: null,
		};
		expect(versionText(h)).toBeNull();
	});
});
