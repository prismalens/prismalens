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
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		const empty = container.querySelector('[data-testid="browser-empty"]');
		expect(empty?.textContent).toBe("No pages open");
	});

	it('Given an agent-owned tab with acting Clicked "Save", When HostBrowserPane renders, Then it shows Agent is using this tab, the acting text, and Take control calls control.mutate', async () => {
		const agentTab: BrowserTab = {
			id: "t1",
			threadId: "th-1",
			url: "https://example.com",
			title: "Example",
			loading: false,
			owner: "agent",
			generation: 1,
			acting: 'Clicked "Save"',
		};
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [agentTab],
		};
		await act(async () => {
			root.render(<HostBrowserPane threadId="th-1" />);
		});
		expect(container.textContent).toContain("Agent is using this tab");
		const actingEl = container.querySelector('[data-testid="browser-acting"]');
		expect(actingEl?.textContent).toBe('Clicked "Save"');
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

	it("Given a human-owned tab, When HostBrowserPane renders, Then it shows You have control and Hand back calls control.mutate", async () => {
		const humanTab: BrowserTab = {
			id: "t1",
			threadId: "th-1",
			url: "https://example.com",
			title: "Example",
			loading: false,
			owner: "human",
			generation: 1,
			acting: null,
		};
		mockStatus.data = {
			engine: "ready",
			engineName: "Chromium",
			canDrive: true,
			tabs: [humanTab],
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
});
