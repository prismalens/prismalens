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

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: {
			version: "0.5.2",
			channel: "npm",
			latestBackup: null,
			update: { available: false, latest: null },
		},
		isError: false,
		refetch: vi.fn(),
	}),
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
