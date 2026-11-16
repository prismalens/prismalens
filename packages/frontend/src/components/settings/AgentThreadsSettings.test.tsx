// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AGENTS_START_WORD,
	AgentThreadsGroup,
	ThreadCapRows,
} from "./AgentThreadsSettings";

const updateSpy = vi.fn();
let mockTreeSettings: Record<string, unknown> | undefined = {
	agentsStartThreads: "ask",
	children: 4,
	perTree: 10,
	pairPerDay: 20,
};
const mockOperator = { managesPairing: true };

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useTreeSettings: () => ({ data: mockTreeSettings }),
	useUpdateTreeSettings: () => ({ mutate: updateSpy, isPending: false }),
}));

const browserUpdateSpy = vi.fn();
vi.mock("@/lib/api/hooks/use-browser-orpc", () => ({
	useBrowserSettings: () => ({ data: { agentBrowser: true } }),
	useUpdateBrowserSettings: () => ({
		mutate: browserUpdateSpy,
		isPending: false,
	}),
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => mockOperator,
}));

vi.mock("@/components/ui/select", async () => {
	const ReactModule = await import("react");
	const Ctx = ReactModule.createContext<{
		value?: string;
		onValueChange?: (v: string) => void;
		disabled?: boolean;
		labels: Map<string, React.ReactNode>;
	}>({ labels: new Map() });

	function collectLabels(
		children: React.ReactNode,
		map: Map<string, React.ReactNode>,
	) {
		ReactModule.Children.forEach(children, (child) => {
			if (!ReactModule.isValidElement(child)) return;
			const props = child.props as {
				value?: unknown;
				children?: React.ReactNode;
			};
			if (props?.value !== undefined && props?.children !== undefined) {
				map.set(String(props.value), props.children);
			}
			if (props?.children) {
				collectLabels(props.children, map);
			}
		});
	}

	return {
		Select: ({
			value,
			onValueChange,
			disabled,
			children,
		}: {
			value?: string;
			onValueChange?: (v: string) => void;
			disabled?: boolean;
			children: React.ReactNode;
		}) => {
			const labels = new Map<string, React.ReactNode>();
			collectLabels(children, labels);
			return (
				<Ctx.Provider value={{ value, onValueChange, disabled, labels }}>
					<div data-testid="select-root" data-value={value}>
						{children}
					</div>
				</Ctx.Provider>
			);
		},
		SelectTrigger: ({
			children,
			className,
			"data-testid": testId,
		}: {
			children?: React.ReactNode;
			className?: string;
			"data-testid"?: string;
		}) => {
			const ctx = ReactModule.useContext(Ctx);
			return (
				<button
					type="button"
					data-testid={testId}
					className={className}
					disabled={ctx.disabled}
				>
					{children}
				</button>
			);
		},
		SelectValue: () => {
			const ctx = ReactModule.useContext(Ctx);
			const label =
				ctx.value != null ? ctx.labels.get(String(ctx.value)) : undefined;
			return <span>{label ?? ctx.value ?? ""}</span>;
		},
		SelectContent: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
		SelectItem: ({
			value,
			children,
		}: {
			value: string;
			children: React.ReactNode;
		}) => {
			const ctx = ReactModule.useContext(Ctx);
			return (
				<button
					type="button"
					data-value={value}
					disabled={ctx.disabled}
					onClick={() => ctx.onValueChange?.(value)}
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
	updateSpy.mockClear();
	browserUpdateSpy.mockClear();
	mockTreeSettings = {
		agentsStartThreads: "ask",
		children: 4,
		perTree: 10,
		pairPerDay: 20,
	};
	mockOperator.managesPairing = true;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("AgentThreadsSettings", () => {
	it("shows starting setting and cap values from stored settings", async () => {
		await act(async () => {
			root.render(
				<>
					<AgentThreadsGroup />
					<ThreadCapRows />
				</>,
			);
		});

		const startTrigger = container.querySelector(
			'[data-testid="agent-threads-start"]',
		);
		// fd1fac924 dropped the depth cap and added Messages per pair.
		const pairTrigger = container.querySelector(
			'[data-testid="agent-threads-pairPerDay"]',
		);
		expect(
			container.querySelector('[data-testid="agent-threads-depth"]'),
		).toBeNull();
		const childrenTrigger = container.querySelector(
			'[data-testid="agent-threads-children"]',
		);
		const perTreeTrigger = container.querySelector(
			'[data-testid="agent-threads-perTree"]',
		);

		expect(startTrigger?.textContent).toContain("Ask each time");
		expect(pairTrigger?.textContent).toContain("20");
		expect(childrenTrigger?.textContent).toContain("4");
		expect(perTreeTrigger?.textContent).toContain("10");
	});

	it("mutates thread start mode and the pair cap on user choice", async () => {
		await act(async () => {
			root.render(
				<>
					<AgentThreadsGroup />
					<ThreadCapRows />
				</>,
			);
		});

		const allowOption = container.querySelector<HTMLButtonElement>(
			'button[data-value="allow"]',
		);
		await act(async () => {
			allowOption?.click();
		});
		expect(updateSpy).toHaveBeenCalledWith({ agentsStartThreads: "allow" });

		const pairRow = container.querySelector(
			'[data-testid="agent-threads-pairPerDay-row"]',
		);
		const pairFifty = pairRow?.querySelector<HTMLButtonElement>(
			'button[data-value="50"]',
		);
		await act(async () => {
			pairFifty?.click();
		});
		expect(updateSpy).toHaveBeenCalledWith({ pairPerDay: 50 });
	});

	it("disables select controls and shows host note when managesPairing is false", async () => {
		mockOperator.managesPairing = false;

		await act(async () => {
			root.render(<AgentThreadsGroup />);
		});

		const trigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="agent-threads-start"]',
		);
		expect(trigger?.disabled).toBe(true);
		expect(container.textContent).toContain(
			"Only the computer running PrismaLens can change this.",
		);
	});

	it("defines AGENTS_START_WORD mapping with expected labels", () => {
		expect(AGENTS_START_WORD).toEqual({
			ask: "Ask each time",
			allow: "Allowed within limits",
			never: "Never",
		});
	});

	it("shows Agents can use the browser switched on, and turning it off saves false (#1061)", async () => {
		await act(async () => {
			root.render(<AgentThreadsGroup />);
		});
		const row = container.querySelector('[data-testid="agent-browser-row"]');
		expect(row?.textContent).toContain("Agents can use the browser");
		// The row's line changed when the per-site ask went (79de724ca);
		// 729edb0d1 makes it the label's hint, not a ? button.
		expect(
			row
				?.querySelector('[data-testid="setting-about"]')
				?.getAttribute("aria-description"),
		).toBe("Its own profile; take control any time");
		const toggle = container.querySelector(
			'[data-testid="agent-browser"]',
		) as HTMLButtonElement;
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		await act(async () => toggle.click());
		expect(browserUpdateSpy).toHaveBeenCalledWith(false);
	});
});
