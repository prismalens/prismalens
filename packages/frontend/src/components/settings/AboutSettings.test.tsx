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
