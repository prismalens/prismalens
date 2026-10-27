// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	pathname: "/incidents",
	sidebarHidden: false,
	toggleSidebar: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ pathname: state.pathname }),
	useMatch: () => undefined,
	useSearch: () => ({}),
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children?: React.ReactNode }) =>
		createElement("a", props, children),
}));

vi.mock("@/components/inbox/use-inbox-data", () => ({
	useNeedsYouCount: () => 0,
}));

vi.mock("@/components/settings", () => ({
	useAbout: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token" }),
}));

vi.mock("@/lib/api/hooks", () => ({
	useServices: () => ({ data: { data: [] } }),
}));

vi.mock("@/hooks/use-media-query", () => ({
	PHONE: "(max-width: 767px)",
	SIDEBAR_FULL: "(min-width: 1280px)",
	useMediaQuery: () => true,
}));

vi.mock("@/hooks/use-breathe-phase", () => ({
	useBreathePhase: () => {},
}));

vi.mock("@/hooks/use-layout-prefs", () => ({
	useLayoutPrefs: () => ({
		sidebarHidden: state.sidebarHidden,
		sidebarFolded: false,
		toggleSidebar: state.toggleSidebar,
	}),
}));

vi.mock("@/components/ThemeToggle", () => ({
	ThemeToggle: () => null,
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock("@/components/shell/IncidentTree", () => ({
	IncidentTree: () => null,
}));

vi.mock("@/components/alerts/AlertListPane", () => ({
	AlertListPane: () => null,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.pathname = "/incidents";
	state.sidebarHidden = false;
	state.toggleSidebar = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("Sidebar (case 2)", () => {
	it("hides sidebar completely when hidden is true, rendering sidebar-show", async () => {
		state.sidebarHidden = true;
		await act(async () => root.render(createElement(Sidebar)));

		expect(container.querySelector('[data-testid="sidebar"]')).toBeNull();
		const showBtn = container.querySelector(
			'[data-testid="sidebar-show"]',
		) as HTMLButtonElement;
		expect(showBtn).not.toBeNull();

		await act(async () => showBtn.click());
		expect(state.toggleSidebar).toHaveBeenCalledTimes(1);
	});

	it("renders sidebar with sidebar-hide button when visible and triggers toggle on [ key", async () => {
		state.sidebarHidden = false;
		await act(async () => root.render(createElement(Sidebar)));

		expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
		const hideBtn = container.querySelector(
			'[data-testid="sidebar-hide"]',
		) as HTMLButtonElement;
		expect(hideBtn).not.toBeNull();

		await act(async () => hideBtn.click());
		expect(state.toggleSidebar).toHaveBeenCalledTimes(1);

		// Press [ key
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
		});
		expect(state.toggleSidebar).toHaveBeenCalledTimes(2);
	});

	it("never hides in Settings, and places settings-back below settings-sections", async () => {
		state.pathname = "/settings";
		state.sidebarHidden = true;
		await act(async () => root.render(createElement(Sidebar)));

		const sidebar = container.querySelector('[data-testid="sidebar"]');
		expect(sidebar).not.toBeNull();
		expect(container.querySelector('[data-testid="sidebar-show"]')).toBeNull();

		const sections = container.querySelector(
			'[data-testid="settings-sections"]',
		);
		const backBtn = container.querySelector('[data-testid="settings-back"]');
		expect(sections).not.toBeNull();
		expect(backBtn).not.toBeNull();

		if (sections && backBtn) {
			expect(
				Boolean(
					sections.compareDocumentPosition(backBtn) &
						Node.DOCUMENT_POSITION_FOLLOWING,
				),
			).toBe(true);
		}
	});
});
