// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutSettings } from "./AboutSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", () => ({
	useLocation: () => ({ hash: "" }),
	Link: ({ children, ...props }: { children?: React.ReactNode }) =>
		createElement("a", props, children),
}));

const about: { current: Record<string, unknown> } = { current: {} };
const baseAbout = {
	version: "0.5.2",
	channel: "npm",
	latestBackup: null,
	update: { available: false, latest: null },
};

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: about.current, isError: false, refetch: vi.fn() }),
	useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
	useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: true }),
}));

vi.mock("@/lib/api/hooks", () => ({
	useResetData: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
	useFactoryReset: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
		error: null,
	}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	about.current = baseAbout;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AboutSettings (case 1)", () => {
	it("renders Danger zone inside About", async () => {
		await act(async () => root.render(createElement(AboutSettings)));
		const dangerZone = container.querySelector('[data-testid="danger-zone"]');
		expect(dangerZone).not.toBeNull();
	});
});

describe("AboutSettings release channel", () => {
	it("shows no Release channel row when the API sends no channel", async () => {
		await act(async () => root.render(createElement(AboutSettings)));
		expect(
			container.querySelector('[data-testid="about-release-channel"]'),
		).toBe(null);
	});

	it("explains that an installer copy can't follow nightly", async () => {
		about.current = {
			...baseAbout,
			channel: "installer",
			updateChannel: {
				current: "stable",
				fromEnv: false,
				nightlyBlockedBy: "not_npm",
				leavingNightly: null,
			},
		};
		await act(async () => root.render(createElement(AboutSettings)));
		expect(
			container.querySelector('[data-testid="about-release-channel"]')
				?.textContent,
		).toBe("Stable");
		expect(container.textContent).toContain(
			"Nightly builds ship on npm only; this copy was installed with the installer",
		);
	});

	it("shows why a nightly install set to stable waits", async () => {
		const note =
			"You're on nightly 0.5.3-nightly.20261111.7. A nightly may have migrated your workspace past an older release, so this install stays on 0.5.3-nightly.20261111.7 and moves to stable when 0.5.3 or later ships.";
		about.current = {
			...baseAbout,
			version: "0.5.3-nightly.20261111.7",
			updateChannel: {
				current: "stable",
				fromEnv: false,
				nightlyBlockedBy: null,
				leavingNightly: note,
			},
		};
		await act(async () => root.render(createElement(AboutSettings)));
		expect(container.textContent).toContain(note);
	});
});

describe("AboutSettings release channel set by the environment", () => {
	it("locks the select and names the variable when PRISMALENS_UPDATE_CHANNEL decides", async () => {
		about.current = {
			...baseAbout,
			updateChannel: {
				current: "nightly",
				fromEnv: true,
				nightlyBlockedBy: null,
				leavingNightly: null,
			},
		};
		await act(async () => root.render(createElement(AboutSettings)));
		const select = container.querySelector(
			'[data-testid="about-release-channel"]',
		);
		expect(select?.textContent).toBe("Nightly");
		expect(select?.hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain(
			"PRISMALENS_UPDATE_CHANNEL sets it; unset it to choose here",
		);
	});
});

describe("AboutSettings names the channel and the build", () => {
	const channel = (over: Record<string, unknown>) => ({
		current: "stable",
		fromEnv: false,
		nightlyBlockedBy: null,
		leavingNightly: null,
		nightlyBuild: false,
		...over,
	});

	it("says which channel is up to date and shows no Nightly badge on a stable build", async () => {
		about.current = { ...baseAbout, updateChannel: channel({}) };
		await act(async () => root.render(createElement(AboutSettings)));
		expect(container.textContent).toContain("Up to date on stable");
		expect(container.querySelector('[data-testid="about-nightly-build"]')).toBe(
			null,
		);
	});

	it("marks a nightly build beside its version and names the nightly channel", async () => {
		about.current = {
			...baseAbout,
			version: "0.5.6-nightly.20261111.1",
			updateChannel: channel({ current: "nightly", nightlyBuild: true }),
		};
		await act(async () => root.render(createElement(AboutSettings)));
		expect(container.textContent).toContain("Up to date on nightly");
		expect(
			container.querySelector('[data-testid="about-nightly-build"]')
				?.textContent,
		).toBe("Nightly");
	});

	it("says it waits for the next stable when a nightly build is set back to stable", async () => {
		about.current = {
			...baseAbout,
			version: "0.5.6-nightly.20261111.1",
			updateChannel: channel({
				leavingNightly: "You're on nightly 0.5.6-nightly.20261111.1.",
				nightlyBuild: true,
			}),
		};
		await act(async () => root.render(createElement(AboutSettings)));
		expect(container.textContent).toContain("Waiting for the next stable");
		expect(container.textContent).not.toContain("Up to date on stable");
	});
});
