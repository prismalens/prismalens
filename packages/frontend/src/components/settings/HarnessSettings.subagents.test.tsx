// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentsGroup, subagentKeys } from "./HarnessSettings";

const mutateSpy = vi.fn();
const mockSettings: Record<string, unknown> = {};
const choice: { effective: { id: string; label: string } | null } = {
	effective: null,
};

// The tree rows have their own tests; here they read the defaults.
vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useTreeSettings: () => ({ data: undefined }),
	useUpdateTreeSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The Agent group holds the browser switch since e4712e7d8; it reads its own settings.
vi.mock("@/lib/api/hooks/use-browser-orpc", () => ({
	useBrowserSettings: () => ({ data: { agentBrowser: true } }),
	useUpdateBrowserSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: true }),
}));
vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({
		data: { harnesses: [], selection: { harness: null } },
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	}),
	useHarnessSettings: () => ({ data: mockSettings, isLoading: false }),
	useUpdateHarnessSettings: () => ({
		mutate: mutateSpy,
		mutateAsync: vi.fn(),
		isPending: false,
		error: null,
	}),
	useCheckHarness: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	useAgentChoice: () => ({
		effective: choice.effective,
		setting: "auto",
		efforts: {},
		axes: { accessLevels: {} },
	}),
	AgentModelPicker: () => null,
	EffortChip: () => null,
	defaultAccessOf: () => ({ level: { level: "supervised" } }),
}));
vi.mock("@/lib/access-levels", () => ({
	agentNote: () => null,
	permissionLine: () => "",
}));
// Each option is a button, so a choice is one click.
vi.mock("@/components/ui/select", async () => {
	const { createContext, useContext } = await import("react");
	const Ctx = createContext<{
		onValueChange: (v: string) => void;
		disabled?: boolean;
	}>({ onValueChange: () => {} });
	return {
		Select: ({
			value,
			onValueChange,
			disabled,
			children,
		}: {
			value: string;
			onValueChange: (v: string) => void;
			disabled?: boolean;
			children: React.ReactNode;
		}) => (
			<Ctx.Provider value={{ onValueChange, disabled }}>
				<div data-testid="limit" data-value={value}>
					{children}
				</div>
			</Ctx.Provider>
		),
		SelectTrigger: () => null,
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => children,
		SelectItem: ({
			value,
			children,
		}: {
			value: string;
			children: React.ReactNode;
		}) => {
			const ctx = useContext(Ctx);
			return (
				<button
					type="button"
					data-value={value}
					disabled={ctx.disabled}
					onClick={() => ctx.onValueChange(value)}
				>
					{children}
				</button>
			);
		},
	};
});

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
	choice.effective = null;
	for (const k of Object.keys(mockSettings)) delete mockSettings[k];
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const limitIn = (row: string) =>
	container.querySelector<HTMLElement>(
		`[data-testid="harness-${row}-row"] [data-testid="limit"]`,
	);
const optionsOf = (row: string) =>
	Array.from(limitIn(row)?.querySelectorAll("button") ?? []);

async function choose(row: string, value: string) {
	const option = optionsOf(row).find((b) => b.dataset.value === value);
	await act(async () => option?.click());
}

// cea3a5938 moved sub-agent settings off the agent-started threads page into Agents → Sub-agents.
describe("Agents → Sub-agents: the agent's in-session helpers, not threads (#1024, #1101)", () => {
	it("lists both limits in the Sub-agents group, each on Agent's default with 1 to 8", async () => {
		await act(async () => root.render(<SubagentsGroup />));
		const group = container.querySelector('[data-testid="harness-subagents"]');
		expect(group?.textContent).toContain("Sub-agents");
		for (const row of ["subagentDepth", "subagentConcurrency"]) {
			expect(group?.contains(limitIn(row))).toBe(true);
			expect(limitIn(row)?.dataset.value).toBe("default");
			expect(optionsOf(row).map((o) => o.textContent)).toEqual([
				"Agent's default",
				"1",
				"2",
				"3",
				"4",
				"5",
				"6",
				"7",
				"8",
			]);
		}
	});

	it("saves a number, and null for Agent's default", async () => {
		mockSettings.subagentConcurrency = 4;
		await act(async () => root.render(<SubagentsGroup />));
		expect(limitIn("subagentConcurrency")?.dataset.value).toBe("4");
		await choose("subagentDepth", "3");
		expect(mutateSpy).toHaveBeenLastCalledWith({ subagentDepth: 3 });
		await choose("subagentConcurrency", "default");
		expect(mutateSpy).toHaveBeenLastCalledWith({ subagentConcurrency: null });
	});

	it("is read-only on a paired device", async () => {
		mockSettings.canEditRuntime = false;
		await act(async () => root.render(<SubagentsGroup />));
		for (const row of ["subagentDepth", "subagentConcurrency"])
			expect(optionsOf(row).every((b) => b.disabled)).toBe(true);
		expect(
			container.querySelector('[data-testid="harness-subagentDepth-row"]')
				?.textContent,
		).toContain("Only the computer running PrismaLens can change this.");
	});

	it("shows Set by the agent where the next run's agent has no key", async () => {
		choice.effective = { id: "gemini", label: "Gemini CLI" };
		await act(async () => root.render(<SubagentsGroup />));
		for (const row of ["subagentDepth", "subagentConcurrency"]) {
			expect(limitIn(row)).toBeNull();
			expect(
				container.querySelector(`[data-testid="harness-${row}-agent"]`)
					?.textContent,
			).toBe("Set by the agent");
		}
	});

	it("gives OpenCode depth only", async () => {
		choice.effective = { id: "opencode", label: "OpenCode" };
		await act(async () => root.render(<SubagentsGroup />));
		expect(limitIn("subagentDepth")).not.toBeNull();
		expect(limitIn("subagentConcurrency")).toBeNull();
		expect(
			container.querySelector(
				'[data-testid="harness-subagentConcurrency-agent"]',
			)?.textContent,
		).toBe("Set by the agent");
	});

	// 2ef62511e moves setting explanations behind Help (?) popovers.
	it("gives Claude Code and Codex both", async () => {
		for (const effective of [
			{ id: "claude-code", label: "Claude Code" },
			{ id: "codex", label: "Codex" },
		]) {
			await act(async () => root.unmount());
			container.innerHTML = "";
			root = createRoot(container);
			choice.effective = effective;
			await act(async () => root.render(<SubagentsGroup />));
			expect(limitIn("subagentDepth")).not.toBeNull();
			expect(limitIn("subagentConcurrency")).not.toBeNull();
			const row = container.querySelector(
				'[data-testid="harness-subagentDepth-row"]',
			);
			// 729edb0d1: a setting's sentence is its label's hint, not a ? button.
			expect(
				Array.from(
					row?.querySelectorAll('[data-testid="setting-about"]') ?? [],
					(e) => e.getAttribute("aria-description"),
				).join("\n"),
			).toContain(`For ${effective.label}`);
		}
	});
});

describe("when you stop a turn: its running sub-agents (#1101 cat 10)", () => {
	const stopIn = () =>
		container.querySelector<HTMLElement>(
			'[data-testid="harness-subagents-stop-row"] [data-testid="limit"]',
		);
	it("defaults to stopping them, and saves Let them finish", async () => {
		choice.effective = { id: "claude-code", label: "Claude Code" };
		await act(async () => root.render(<SubagentsGroup />));
		expect(stopIn()?.dataset.value).toBe("stop");
		const finish = Array.from(stopIn()?.querySelectorAll("button") ?? []).find(
			(b) => b.dataset.value === "finish",
		);
		await act(async () => finish?.click());
		expect(mutateSpy).toHaveBeenLastCalledWith({ subagentsOnStop: "finish" });
		expect(
			container.querySelector(
				'[data-testid="harness-subagents-stop-unhonoured"]',
			),
		).toBeNull();
	});

	it("says when the next run's agent cannot honour the choice, from the registry's facts", async () => {
		choice.effective = { id: "opencode", label: "OpenCode" };
		await act(async () => root.render(<SubagentsGroup />));
		expect(
			container.querySelector(
				'[data-testid="harness-subagents-stop-unhonoured"]',
			)?.textContent,
		).toBe("Not on OpenCode");
		expect(
			Object.fromEntries(
				(["claude-code", "codex", "opencode", "gemini"] as const).map((id) => {
					const f = HARNESS_REGISTRY[id].facts?.subagentsOnStop?.value;
					return [id, [f?.stop, f?.finish]];
				}),
			),
		).toEqual({
			"claude-code": [true, true],
			codex: [false, false],
			opencode: [false, false],
			gemini: [true, false],
		});
	});
});

describe("which agents take a sub-agent limit (#1024)", () => {
	it("reads the agent registry's own keys", () => {
		expect(
			Object.fromEntries(HARNESS_IDS.map((id) => [id, subagentKeys(id)])),
		).toEqual({
			"claude-code": { depth: true, concurrency: true },
			codex: { depth: true, concurrency: true },
			opencode: { depth: true, concurrency: false },
			gemini: { depth: false, concurrency: false },
			deepagents: { depth: false, concurrency: false },
			local: { depth: false, concurrency: false },
		});
		expect(HARNESS_REGISTRY.opencode.subagentLimits?.depth).toBeDefined();
	});
});
