// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	HarnessStatus,
	LoadedItem,
	AgentLoadout as Loadout,
	SharedSet,
} from "@prismalens/contracts";
import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLoadout, AgentLoadoutView } from "./AgentLoadout";

const loadoutCalls: { input: unknown; enabled: boolean }[] = [];
const membershipSpy = vi.fn();
let mockLoadout: Loadout | undefined;
let mockSet: SharedSet | undefined;

vi.mock("@/lib/api/hooks/use-agent-setup-orpc", () => ({
	useAgentLoadout: (input: unknown, enabled: boolean) => {
		loadoutCalls.push({ input, enabled });
		return { data: enabled ? mockLoadout : undefined, isError: false };
	},
	useSharedSet: () => ({ data: mockSet }),
	useSetSharedMembership: () => ({ mutate: membershipSpy, isPending: false }),
}));

vi.mock("@/lib/api/hooks/use-repositories-orpc", () => ({
	useRepositories: () => ({
		isLoading: false,
		data: {
			data: [
				{
					id: "r-1",
					fullName: "acme/api",
					updatedAt: "2026-11-20T10:00:00.000Z",
				},
				{
					id: "r-2",
					fullName: "acme/web",
					updatedAt: "2026-11-25T10:00:00.000Z",
				},
			],
		},
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...rest
	}: {
		children: React.ReactNode;
		to: string;
		params?: { id: string };
	}) => (
		<a href={to.replace("$id", params?.id ?? "")} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/select", async () => {
	const R = await import("react");
	const Ctx = R.createContext<{
		value?: string;
		onValueChange?: (v: string) => void;
	}>({});
	return {
		Select: ({
			value,
			onValueChange,
			children,
		}: {
			value?: string;
			onValueChange?: (v: string) => void;
			children: React.ReactNode;
		}) => (
			<Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
		),
		SelectTrigger: () => null,
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => (
			<div data-testid="stub-select">{children}</div>
		),
		SelectItem: ({
			value,
			children,
		}: {
			value: string;
			children: React.ReactNode;
		}) => {
			const c = R.useContext(Ctx);
			return (
				<button
					type="button"
					aria-pressed={c.value === value}
					data-testid={`stub-option-${value}`}
					onClick={() => c.onValueChange?.(value)}
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

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

const item = (over: Partial<LoadedItem> & Pick<LoadedItem, "kind" | "name">) =>
	({
		scope: "global",
		path: null,
		disk: true,
		reported: null,
		state: "found",
		...over,
	}) as LoadedItem;

const ITEMS: LoadedItem[] = [
	item({
		kind: "instructions",
		name: "CLAUDE.md",
		path: "~/.claude/CLAUDE.md",
		reported: "2026-11-26T10:00:00.000Z",
		state: "loads",
	}),
	item({
		kind: "mcp",
		name: "github",
		scope: "repo",
		path: "<repo>/.mcp.json",
		state: "in-project",
	}),
	item({
		kind: "mcp",
		name: "pl-docs",
		scope: "prismalens",
		disk: false,
		state: "not-sent",
		note: "Not sent: no HTTP",
	}),
	item({
		kind: "hook",
		name: "pre-tool",
		path: "~/.claude/settings.json",
		state: "failed",
	}),
	item({ kind: "plugin", name: "lint", state: "off" }),
];

const loadout = (over: Partial<Loadout> = {}): Loadout => ({
	agent: "claude-code",
	repositoryId: null,
	profile: "own",
	readAt: "2026-11-26T12:00:00.000Z",
	readable: true,
	report: null,
	staleReport: null,
	items: ITEMS,
	...over,
});

const agent = {
	id: "claude-code",
	label: "Claude Code",
	installed: true,
} as HarnessStatus;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	loadoutCalls.length = 0;
	membershipSpy.mockClear();
	mockLoadout = loadout();
	mockSet = {
		decided: null,
		instructions: "",
		instructionsFor: [],
		revision: "r0",
		servers: [],
	};
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = async (node: React.ReactNode) => {
	await act(async () => root.render(node));
};
const byId = (id: string) =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (el: Element | null | undefined) => el?.textContent ?? null;

describe("AgentLoadoutView", () => {
	it("puts each item in its kind's group with its path, how it is known and its state word", async () => {
		await render(<AgentLoadoutView loadout={loadout()} now={NOW} />);
		const row = (id: string) => byId(`loadout-item-${id}`);
		const claude = row("instructions-global-CLAUDE.md");
		expect(byId("loadout-group-instructions")?.contains(claude ?? null)).toBe(
			true,
		);
		expect(text(claude?.querySelector(".font-mono"))).toBe(
			"~/.claude/CLAUDE.md",
		);
		expect(
			text(claude?.querySelector('[data-testid="loadout-via-disk"]')),
		).toBe("On disk");
		expect(
			text(claude?.querySelector('[data-testid="loadout-via-reported"]')),
		).toBe("Reported 2h ago");
		expect(text(claude?.querySelector('[data-testid="loadout-state"]'))).toBe(
			"Loads",
		);

		const github = row("mcp-repo-github");
		expect(byId("loadout-group-mcp")?.contains(github ?? null)).toBe(true);
		expect(
			text(github?.querySelector('[data-testid="loadout-via-disk"]')),
		).toBe("On disk");
		expect(
			github?.querySelector('[data-testid="loadout-via-reported"]'),
		).toBeNull();
		expect(text(github?.querySelector('[data-testid="loadout-state"]'))).toBe(
			"In this project",
		);

		const docs = row("mcp-prismalens-pl-docs");
		expect(docs?.querySelectorAll('[data-testid^="loadout-via-"]').length).toBe(
			0,
		);
		expect(text(docs?.querySelector('[data-testid="loadout-state"]'))).toBe(
			"Not sent: no HTTP",
		);
		expect(
			text(
				row("hook-global-pre-tool")?.querySelector(
					'[data-testid="loadout-state"]',
				),
			),
		).toBe("Could not read");
		expect(
			text(
				row("plugin-global-lint")?.querySelector(
					'[data-testid="loadout-state"]',
				),
			),
		).toBe("Off");
		expect(text(byId("loadout-group-skill")?.querySelector("p"))).toBe(
			"None found",
		);
		expect(
			[...container.querySelectorAll("section h3")].map((h) => h.textContent),
		).toEqual([
			"Instructions1",
			"Plugins1",
			"Skills0",
			"MCP servers2",
			"Hooks1",
		]);
	});

	it("shows Not readable for this agent in every group when PrismaLens has no layout for it", async () => {
		await render(
			<AgentLoadoutView
				loadout={loadout({ readable: false, items: [] })}
				now={NOW}
			/>,
		);
		const groups = [...container.querySelectorAll("section")];
		expect(groups.map((g) => text(g.querySelector("p")))).toEqual([
			"Not readable for this agent",
			"Not readable for this agent",
			"Not readable for this agent",
			"Not readable for this agent",
			"Not readable for this agent",
		]);
	});

	it("puts the report's time and a link to its thread under the heading", async () => {
		await render(
			<AgentLoadoutView
				loadout={loadout({
					report: { at: "2026-11-26T09:00:00.000Z", threadId: "t-1" },
					staleReport: { at: "2026-11-25T09:00:00.000Z", threadId: "t-0" },
				})}
				now={NOW}
			/>,
		);
		const line = byId("loadout-report");
		expect(text(line?.querySelector("time"))).toBe("Reported 3h ago");
		expect(line?.querySelector("a")?.getAttribute("href")).toBe("/threads/t-1");
		expect(text(line?.querySelector("a"))).toBe("Open thread");
		expect(byId("loadout-stale")).toBeNull();
	});

	it("links Last run had a different setup to that run's thread when no report matches", async () => {
		await render(
			<AgentLoadoutView
				loadout={loadout({
					staleReport: { at: "2026-11-25T09:00:00.000Z", threadId: "t-0" },
				})}
				now={NOW}
			/>,
		);
		const link = byId("loadout-stale")?.querySelector("a");
		expect(text(link)).toBe("Last run had a different setup");
		expect(link?.getAttribute("href")).toBe("/threads/t-0");
		expect(byId("loadout-report")).toBeNull();
	});

	it("notes a clean profile under the heading", async () => {
		await render(
			<AgentLoadoutView loadout={loadout({ profile: "clean" })} now={NOW} />,
		);
		expect(text(byId("loadout-profile"))).toBe(
			"Clean profile. Skips your hooks and plugins.",
		);
	});
});

const open = async () => {
	const details = byId("agent-loadout") as HTMLDetailsElement;
	await act(async () => {
		details.open = true;
		details.dispatchEvent(new Event("toggle"));
	});
};

describe("AgentLoadout", () => {
	it("reads nothing while folded, then reads the most recently changed project once opened", async () => {
		await render(<AgentLoadout agent={agent} />);
		expect(text(byId("agent-loadout")?.querySelector("summary"))).toBe(
			"What loads",
		);
		expect(loadoutCalls).toEqual([]);
		await open();
		expect(loadoutCalls.at(-1)).toEqual({
			input: { id: "claude-code", repositoryId: "r-2" },
			enabled: true,
		});
		expect(byId("agent-loadout-view")).not.toBeNull();
	});

	it("reads the agent's global loadout when Global is picked", async () => {
		await render(<AgentLoadout agent={agent} />);
		await open();
		expect(byId("stub-option-r-2")?.getAttribute("aria-pressed")).toBe("true");
		await act(async () => byId("stub-option-global")?.click());
		expect(byId("stub-option-global")?.getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(loadoutCalls.at(-1)).toEqual({
			input: { id: "claude-code" },
			enabled: true,
		});
	});

	it("labels the Use PrismaLens set switch from agent.useSharedSet and sends this agent's membership", async () => {
		await render(<AgentLoadout agent={agent} />);
		await open();
		const row = byId("agent-use-shared-set");
		expect(text(row?.querySelector("label"))).toBe("Use PrismaLens set");
		const sw = byId("agent-use-shared-set-switch");
		expect(sw?.getAttribute("aria-checked")).toBe("false");
		await act(async () => sw?.click());
		expect(membershipSpy).toHaveBeenCalledTimes(1);
		expect(membershipSpy).toHaveBeenCalledWith({
			id: "claude-code",
			member: true,
		});
	});
});
