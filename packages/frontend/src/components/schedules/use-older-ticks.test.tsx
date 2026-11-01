// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useOlderTicks } from "./use-older-ticks";

const get = vi.fn();
vi.mock("@/lib/api/orpc-client", () => ({
	client: { schedules: { get: (...a: unknown[]) => get(...a) } },
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useOlderTicks (#979)", () => {
	it("reports a failed page through onError and lets the button try again", async () => {
		get.mockRejectedValueOnce(new Error("host unreachable"));
		const onError = vi.fn();
		let hook!: ReturnType<typeof useOlderTicks>;
		const Probe = () => {
			hook = useOlderTicks("s1", onError);
			return null;
		};
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(<Probe />));

		await act(async () => hook.more("c1"));
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "host unreachable" }),
		);
		expect(hook.loading).toBe(false);
		expect(hook.ticks).toEqual([]);

		get.mockResolvedValueOnce({ ticks: [{ id: "t1" }], nextCursor: null });
		await act(async () => hook.more("c1"));
		expect(hook.ticks).toEqual([{ id: "t1" }]);
		expect(hook.done).toBe(true);
		expect(onError).toHaveBeenCalledTimes(1);
		await act(async () => root.unmount());
	});
});
