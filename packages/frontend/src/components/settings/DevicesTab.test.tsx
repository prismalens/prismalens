// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PairedDevice } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicesTab } from "./DevicesTab";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	managesPairing: true,
	devices: [] as PairedDevice[],
	createLinkMutate: vi.fn(),
};

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: state.managesPairing }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		invalidateQueries: vi.fn(),
	}),
	useQuery: () => ({
		data: { devices: state.devices },
		isPending: false,
		isError: false,
		refetch: vi.fn(),
	}),
	useMutation: (options?: { mutationKey?: string }) => {
		if (options?.mutationKey === "createLink") {
			return {
				mutate: (args: unknown) => state.createLinkMutate(args),
				mutateAsync: vi.fn(),
				isPending: false,
				error: null,
				data: null,
				reset: vi.fn(),
			};
		}
		return {
			mutate: vi.fn(),
			mutateAsync: vi.fn(),
			isPending: false,
			error: null,
			data: null,
			reset: vi.fn(),
		};
	},
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		pairing: {
			manage: {
				listDevices: {
					queryOptions: () => ({ queryKey: ["pairing", "devices"] }),
					queryKey: () => ["pairing", "devices"],
				},
				createLink: {
					mutationOptions: () => ({ mutationKey: "createLink" }),
				},
				revokeDevice: {
					mutationOptions: () => ({ mutationKey: "revokeDevice" }),
				},
				renameDevice: {
					mutationOptions: () => ({ mutationKey: "renameDevice" }),
				},
			},
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.managesPairing = true;
	state.devices = [];
	state.createLinkMutate = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("DevicesTab device levels", () => {
	it("switch defaults off and createLink is called with canStartRuns: false, and turning it on sends true", async () => {
		await act(async () => root.render(createElement(DevicesTab)));

		const switchEl = container.querySelector(
			'[data-testid="device-start-runs"]',
		) as HTMLButtonElement | null;
		expect(switchEl).not.toBeNull();
		expect(switchEl?.getAttribute("aria-checked")).toBe("false");

		const createBtn = container.querySelector(
			'[data-testid="device-create-link"]',
		) as HTMLButtonElement | null;
		expect(createBtn).not.toBeNull();

		await act(async () => {
			createBtn?.click();
		});
		expect(state.createLinkMutate).toHaveBeenLastCalledWith(
			expect.objectContaining({ canStartRuns: false }),
		);

		await act(async () => {
			switchEl?.click();
		});
		expect(switchEl?.getAttribute("aria-checked")).toBe("true");

		await act(async () => {
			createBtn?.click();
		});
		expect(state.createLinkMutate).toHaveBeenLastCalledWith(
			expect.objectContaining({ canStartRuns: true }),
		);
	});

	it('a device with canStartRuns: false shows "view and answer"', async () => {
		state.devices = [
			{
				id: "dev-view-only",
				name: "Sumit's Phone",
				userAgent: "curl/8.5.0",
				current: false,
				createdAt: "2026-10-12T10:00:00Z",
				lastSeenAt: null,
				push: null,
				canStartRuns: false,
			},
			{
				id: "dev-operate",
				name: "Sumit's Laptop",
				userAgent: "curl/8.5.0",
				current: false,
				createdAt: "2026-10-12T10:00:00Z",
				lastSeenAt: null,
				push: null,
				canStartRuns: true,
			},
		];

		await act(async () => root.render(createElement(DevicesTab)));

		const rows = container.querySelectorAll('[data-testid="device-row"]');
		expect(rows).toHaveLength(2);

		const viewOnlyBadge = rows[0]?.querySelector(
			'[data-testid="device-view-only"]',
		);
		expect(viewOnlyBadge).not.toBeNull();
		expect(viewOnlyBadge?.textContent?.trim()).toBe("view and answer");

		const operateBadge = rows[1]?.querySelector(
			'[data-testid="device-view-only"]',
		);
		expect(operateBadge).toBeNull();
	});
});
