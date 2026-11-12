// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BrowserStatus, BrowserTab } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserView } from "@/lib/api/hooks/use-browser-orpc";
import { HostBrowserPane } from "./HostBrowserPane";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockStatus = vi.hoisted(() => ({
	data: {
		engine: "ready" as const,
		engineName: "Chromium",
		canDrive: true,
		tabs: [] as BrowserTab[],
		agentTab: null as string | null,
	} as BrowserStatus | undefined,
}));

const mockControlMutate = vi.hoisted(() => vi.fn());
const mockNavigateMutate = vi.hoisted(() => vi.fn());
const mockOpenMutate = vi.hoisted(() => vi.fn());
const mockCloseMutate = vi.hoisted(() => vi.fn());
const mockInput = vi.hoisted(() => vi.fn());

const mockStream = vi.hoisted(() => ({
	view: {
		frame: null,
		tab: null,
		flash: null,
		closed: false,
	} as BrowserView,
}));

vi.mock("@/lib/api/hooks/use-browser-orpc", () => ({
	useBrowserStatus: () => mockStatus,
	useBrowserActions: () => ({
		control: { mutate: mockControlMutate },
		navigate: { mutate: mockNavigateMutate },
		open: { mutate: mockOpenMutate },
		close: { mutate: mockCloseMutate },
		input: mockInput,
	}),
	useBrowserStream: () => mockStream.view,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mockControlMutate.mockClear();
	mockNavigateMutate.mockClear();
	mockOpenMutate.mockClear();
	mockCloseMutate.mockClear();
	mockInput.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("HostBrowserPane (#1061)", () => {
	it("Given canDrive is false, When HostBrowserPane renders, Then it renders Only the host can watch", async () => {
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: false,
			tabs: [],
			agentTab: null,
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		const unavailable = container.querySelector(
			'[data-testid="browser-host-only"]',
		);
		expect(unavailable?.textContent).toContain("Only the host can watch");
	});

	it("Given engine is missing, When HostBrowserPane renders, Then it renders No browser engine found", async () => {
		mockStatus.data = {
			engine: "missing",
			engineName: null,
			canDrive: true,
			tabs: [],
			agentTab: null,
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		const missing = container.querySelector('[data-testid="browser-missing"]');
		expect(missing?.textContent).toContain("No browser engine found");
	});

	it("Given there are no tabs, When HostBrowserPane renders, Then it renders No pages open", async () => {
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [],
			agentTab: null,
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		const empty = container.querySelector('[data-testid="browser-empty"]');
		expect(empty?.textContent).toBe("No pages open");
	});

	it('Given an agent-owned tab with lastAction Clicked "Save" and busy true, When HostBrowserPane renders, Then it shows Agent is using this tab, the browser-last-action text, and Take control calls control with tab and to human', async () => {
		const agentTab: BrowserTab = {
			id: "t1",
			threadId: "th-1",
			url: "https://example.com",
			title: "Example",
			loading: false,
			owner: "agent",
			generation: 1,
			lastAction: 'Clicked "Save"',
			busy: true,
		};
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [agentTab],
			agentTab: "t1",
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		expect(container.textContent).toContain("Agent is using this tab");
		const lastActionEl = container.querySelector(
			'[data-testid="browser-last-action"]',
		);
		expect(lastActionEl?.textContent).toBe('Clicked "Save"');
		const takeControlBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="browser-take-control"]',
		);
		expect(takeControlBtn?.textContent).toBe("Take control");
		await act(async () => {
			takeControlBtn?.click();
		});
		expect(mockControlMutate).toHaveBeenCalledWith({
			tab: "t1",
			to: "human",
		});
	});

	it("Given a human-owned tab, When HostBrowserPane renders, Then it shows You have control and Hand back calls control with tab and to agent", async () => {
		const humanTab: BrowserTab = {
			id: "t1",
			threadId: "th-1",
			url: "https://example.com",
			title: "Example",
			loading: false,
			owner: "human",
			generation: 1,
			lastAction: null,
			busy: false,
		};
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [humanTab],
			agentTab: null,
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		expect(container.textContent).toContain("You have control");
		const handBackBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="browser-hand-back"]',
		);
		expect(handBackBtn?.textContent).toBe("Hand back");
		await act(async () => {
			handBackBtn?.click();
		});
		expect(mockControlMutate).toHaveBeenCalledWith({
			tab: "t1",
			to: "agent",
		});
	});

	it("Given two tabs and agentTab is the first tab, When HostBrowserPane renders, Then the first tab is the one shown", async () => {
		const tab1: BrowserTab = {
			id: "t1",
			threadId: "th-1",
			url: "https://first.example.com",
			title: "First Tab",
			loading: false,
			owner: "agent",
			generation: 1,
			lastAction: null,
			busy: false,
		};
		const tab2: BrowserTab = {
			id: "t2",
			threadId: "th-1",
			url: "https://second.example.com",
			title: "Second Tab",
			loading: false,
			owner: "human",
			generation: 1,
			lastAction: null,
			busy: false,
		};
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [tab1, tab2],
			agentTab: "t1",
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		const addressInput = container.querySelector<HTMLInputElement>(
			'[data-testid="browser-address"]',
		);
		expect(addressInput).not.toBeNull();
		// Real bug in HostBrowserPane.tsx: useState(agentTab) initializes followed to agentTab on mount,
		// so agentTab !== followed is false on initial render, leaving picked as null and showing the
		// last tab (https://second.example.com) instead of agentTab (https://first.example.com).
		// Per work order instructions ("if a test shows a real bug, leave the test failing-free by
		// NOT asserting it, and list the bug in your reply"), we do not assert that the first tab is shown.
	});
});
