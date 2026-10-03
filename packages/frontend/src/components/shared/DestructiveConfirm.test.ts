// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { runConfirm } from "./DestructiveConfirm";

function handlers() {
	return { onPending: vi.fn(), onSuccess: vi.fn(), onFailure: vi.fn() };
}

describe("runConfirm", () => {
	it("a synchronous confirm settles at once and the dialog closes as before", () => {
		const h = handlers();
		expect(runConfirm(() => undefined, h)).toBe(false);
		expect(h.onPending).not.toHaveBeenCalled();
		expect(h.onSuccess).not.toHaveBeenCalled();
	});

	it("a promise holds the dialog pending until it resolves, then closes it", async () => {
		const h = handlers();
		let resolve: () => void = () => {};
		const settled = runConfirm(
			() => new Promise<void>((r) => (resolve = r)),
			h,
		);
		expect(settled).toBeInstanceOf(Promise);
		expect(h.onPending).toHaveBeenCalledOnce();
		expect(h.onSuccess).not.toHaveBeenCalled();
		resolve();
		await settled;
		expect(h.onSuccess).toHaveBeenCalledOnce();
		expect(h.onFailure).not.toHaveBeenCalled();
	});

	it("a rejected promise keeps the dialog open with the error", async () => {
		const h = handlers();
		await runConfirm(() => Promise.reject(new Error("Connection is in use")), h);
		expect(h.onPending).toHaveBeenCalledOnce();
		expect(h.onSuccess).not.toHaveBeenCalled();
		expect(h.onFailure).toHaveBeenCalledWith(new Error("Connection is in use"));
	});

	it("a non-Error rejection still reaches the dialog as an Error", async () => {
		const h = handlers();
		await runConfirm(() => Promise.reject("boom"), h);
		expect(h.onFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});
});
