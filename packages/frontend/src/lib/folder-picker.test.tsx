// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FolderPicker, useFolderPicker } from "./folder-picker";

let available: { available: boolean } | undefined;
let queryEnabled: boolean | undefined;
const apiPick = vi.fn();
let bridge: { pickFolder?: () => Promise<unknown> } | undefined;

vi.mock("@tanstack/react-query", () => ({
	useQuery: (o: { enabled: boolean }) => {
		queryEnabled = o.enabled;
		return { data: o.enabled ? available : undefined };
	},
}));
vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		repositories: {
			pickFolderAvailable: {
				queryOptions: () => ({ queryKey: ["available"] }),
			},
		},
	},
	client: { repositories: { pickFolder: (i: unknown) => apiPick(i) } },
}));
vi.mock("@/lib/desktop", () => ({ desktopBridge: () => bridge }));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let seat: FolderPicker;
let container: HTMLDivElement;

function Probe({ host }: { host: boolean }) {
	seat = useFolderPicker(host);
	return null;
}
const mount = (host: boolean) =>
	act(async () => root.render(<Probe host={host} />));

beforeEach(() => {
	container = document.createElement("div");
	root = createRoot(container);
	available = { available: true };
	queryEnabled = undefined;
	bridge = undefined;
	apiPick.mockReset();
});
afterEach(async () => {
	await act(async () => root.unmount());
});

describe("useFolderPicker (#1216)", () => {
	it("is available in a browser when the API says the host has a dialog", async () => {
		await mount(true);
		expect(seat).toMatchObject({ desktop: false, available: true });
	});

	it("is not available, and never asks the API, for a viewer that is not the host", async () => {
		await mount(false);
		expect(seat.available).toBe(false);
		expect(queryEnabled).toBe(false);
	});

	it("is not available when the API reports no dialog tool", async () => {
		available = { available: false };
		await mount(true);
		expect(seat.available).toBe(false);
	});

	it("answers the API's pick as it came", async () => {
		apiPick.mockResolvedValue({ status: "picked", path: "/work" });
		await mount(true);
		expect(await seat.pick()).toEqual({ status: "picked", path: "/work" });
		expect(apiPick).toHaveBeenCalledExactlyOnceWith({});
	});

	it("takes a refused API call as unavailable and stops offering", async () => {
		apiPick.mockRejectedValue(
			Object.assign(new Error("403"), { code: "FORBIDDEN" }),
		);
		await mount(true);
		let got: unknown;
		await act(async () => {
			got = await seat.pick();
		});
		expect(got).toEqual({ status: "unavailable" });
		expect(seat.available).toBe(false);
	});

	it("takes a dropped connection as a failed pick and keeps offering Browse for another try", async () => {
		apiPick.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		apiPick.mockResolvedValueOnce({ status: "picked", path: "/work" });
		await mount(true);
		let got: unknown;
		await act(async () => {
			got = await seat.pick();
		});
		expect(got).toEqual({ status: "failed" });
		expect(seat.available).toBe(true);
		expect(await seat.pick()).toEqual({ status: "picked", path: "/work" });
	});

	it("uses the desktop bridge when there is one, without asking the API", async () => {
		bridge = { pickFolder: async () => ({ path: "C:\\desk" }) };
		await mount(true);
		expect(seat).toMatchObject({ desktop: true, available: true });
		expect(queryEnabled).toBe(false);
		expect(await seat.pick()).toEqual({ status: "picked", path: "C:\\desk" });
		expect(apiPick).not.toHaveBeenCalled();
	});

	it("reads the bridge's null path as a cancel", async () => {
		bridge = { pickFolder: async () => ({ path: null }) };
		await mount(true);
		expect(await seat.pick()).toEqual({ status: "cancelled" });
	});

	it("reads the bridge's unavailable as unavailable and stops offering", async () => {
		bridge = { pickFolder: async () => ({ unavailable: true }) };
		await mount(true);
		await act(async () => {
			await seat.pick();
		});
		expect(seat.available).toBe(false);
	});
});
