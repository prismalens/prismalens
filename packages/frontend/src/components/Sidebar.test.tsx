// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppKeys } from "@/hooks/app-keys";
import { Sidebar } from "./Sidebar";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	pathname: "/incidents",
	hydrated: true,
	sidebarHidden: false,
	toggleSidebar: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
	// The sidebar reads the path through `select` since 5ef099552; the mock applies it as the router does.
	useLocation: (o?: { select?: (l: { pathname: string }) => unknown }) => {
		const l = { pathname: state.pathname };
		return o?.select ? o.select(l) : l;
	},
	useHydrated: () => state.hydrated,
	useRouter: () => ({
		buildLocation: ({ to }: { to: string }) => ({ href: `${to}#built` }),
	}),
	useMatch: () => undefined,
	useSearch: () => ({}),
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children?: React.ReactNode }) =>
		createElement("a", props, children),
}));

vi.mock("@/components/inbox/use-inbox-data", () => ({
	useNeedsYouCount: () => 0,
	useActiveIncidents: () => ({ incidents: [], isLoading: false }),
}));

vi.mock("@/lib/api/hooks/use-webhooks-orpc", () => ({
	useLastDelivery: () => ({ data: null }),
}));

const about: { data: unknown } = { data: undefined };
// Sidebar reads useAbout from its own light module (#1101 category 12).
vi.mock("@/components/settings/use-about", () => ({
	useAbout: () => about,
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token" }),
}));

// The event list's bell reads the attention API; Sidebar's layout is tested here.
vi.mock("@/components/attention/EventList", () => ({
	useUnreadEvents: () => 0,
}));
vi.mock("@/lib/api/hooks", () => ({
	useServices: () => ({ data: { data: [] } }),
}));

vi.mock("@/hooks/use-media-query", () => ({
	PHONE: "(max-width: 767px)",
	SIDEBAR_FULL: "(min-width: 1280px)",
	useMediaQuery: (q: string) =>
		q === "(min-width: 1280px)" ? media.full : true,
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

const unmapped = { n: 0 };
const waiting = { n: 0 };
const media = { full: true };
vi.mock("@/components/shell/ThreadList", () => ({
	ThreadList: () => null,
	useWaitingCount: () => waiting.n,
	useUnmappedAlerts: () => unmapped.n,
}));

vi.mock("@/components/shell/SearchHost", () => ({
	SearchHost: ({ children }: { children: React.ReactNode }) => children,
	useOpenSearch: () => () => {},
}));

vi.mock("@/components/alerts/AlertListPane", () => ({
	AlertListPane: () => null,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	about.data = undefined;
	unmapped.n = 0;
	waiting.n = 0;
	media.full = true;
	state.pathname = "/incidents";
	state.hydrated = true;
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

/** The shortcut runner's app keys, mounted beside the Sidebar as the layout does. */
function AppKeys() {
	useAppKeys();
	return null;
}

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
		// [ is the app.foldSidebar key; the shortcut runner runs it (moved there in this change).
		await act(async () =>
			root.render(
				createElement(
					Fragment,
					null,
					createElement(AppKeys),
					createElement(Sidebar),
				),
			),
		);

		expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
		const hideBtn = container.querySelector(
			'[data-testid="sidebar-hide"]',
		) as HTMLButtonElement;
		expect(hideBtn).not.toBeNull();

		await act(async () => hideBtn.click());
		expect(state.toggleSidebar).toHaveBeenCalledTimes(1);

		// Press [ key: the runner's app keys run the fold command the Sidebar registered
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
		});
		expect(state.toggleSidebar).toHaveBeenCalledTimes(2);
	});

	it("keeps the app's own bar in Settings; the sections live in the page", async () => {
		state.pathname = "/settings";
		await act(async () => root.render(createElement(Sidebar)));

		expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="nav-new"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="settings-sections"]'),
		).toBeNull();
	});
});

// 869f02a4e named Home as Home and made unmapped alerts a labelled door.
describe("Sidebar doors (#1101 navigation)", () => {
	it("names Home as Home and has no Events door", async () => {
		await act(async () => root.render(createElement(Sidebar)));
		const home = container.querySelector('[data-testid="nav-new"]');
		expect(home?.getAttribute("aria-label")).toBe("Home");
		expect(container.querySelector('[data-testid="nav-events"]')).toBeNull();
	});

	it("shows no Alerts door while every alert has a service", async () => {
		await act(async () => root.render(createElement(Sidebar)));
		expect(container.querySelector('[data-testid="nav-alerts"]')).toBeNull();
	});

	it("labels 30 unmapped alerts as the Alerts door with its count", async () => {
		unmapped.n = 30;
		await act(async () => root.render(createElement(Sidebar)));
		const door = container.querySelector('[data-testid="nav-alerts"]');
		expect(door?.getAttribute("aria-label")).toBe("Alerts 30 with no service");
		expect(
			container.querySelector('[data-testid="nav-alerts-count"]')?.textContent,
		).toBe("30");
	});

	it("names the Threads door by its visible word and count first: Threads 3 waiting for you", async () => {
		waiting.n = 3;
		media.full = false;
		await act(async () => root.render(createElement(Sidebar)));
		const door = container.querySelector('[data-testid="nav-threads"]');
		expect(door?.getAttribute("aria-label")).toBe("Threads 3 waiting for you");
		expect(door?.textContent).toBe("Threads3");
	});
});

// The built app's shell is prerendered at "/", so the first render must draw "/" too (#418).
describe("Sidebar before hydration", () => {
	it("draws the '/' shell on /settings: no current door, plain anchors with built hrefs", async () => {
		state.hydrated = false;
		state.pathname = "/settings";
		await act(async () => root.render(createElement(Sidebar)));
		const settings = container.querySelector('[data-testid="nav-settings"]');
		expect(settings?.getAttribute("href")).toBe("/settings#built");
		expect(settings?.getAttribute("aria-current")).toBeNull();
		expect(
			container.querySelector('[data-testid="nav-new"]')?.getAttribute("href"),
		).toBe("/new#built");
	});

	it("draws the shell on /pair until hydrated, then hides itself there", async () => {
		state.hydrated = false;
		state.pathname = "/pair";
		await act(async () => root.render(createElement(Sidebar)));
		expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
		state.hydrated = true;
		await act(async () =>
			root.render(createElement(Sidebar, { key: "after" })),
		);
		expect(container.querySelector('[data-testid="sidebar"]')).toBeNull();
	});
});

describe("Sidebar on a nightly build", () => {
	it("tags the app name Nightly when the build is nightly, whatever channel it follows", async () => {
		await act(async () => root.render(createElement(Sidebar)));
		expect(container.querySelector('[data-testid="sidebar-nightly"]')).toBe(
			null,
		);

		// A stable build following nightly: the tag follows the build, so none.
		about.data = {
			update: { available: false },
			updateChannel: {
				current: "nightly",
				fromEnv: false,
				nightlyBlockedBy: null,
				leavingNightly: null,
				nightlyBuild: false,
			},
		};
		await act(async () => root.render(createElement(Sidebar)));
		expect(container.querySelector('[data-testid="sidebar-nightly"]')).toBe(
			null,
		);

		// A nightly build set back to stable: still tagged Nightly.
		about.data = {
			update: { available: false },
			updateChannel: {
				current: "stable",
				fromEnv: false,
				nightlyBlockedBy: null,
				leavingNightly: "You're on nightly 0.5.6-nightly.20261111.6.",
				nightlyBuild: true,
			},
		};
		await act(async () => root.render(createElement(Sidebar)));
		expect(
			container.querySelector('[data-testid="sidebar-nightly"]')?.textContent,
		).toBe("Nightly");
	});
});
