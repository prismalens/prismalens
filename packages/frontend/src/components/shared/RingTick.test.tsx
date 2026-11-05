// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RingTick, SETTLE_MS, useRingTick } from "./RingTick";

function Probe({ pending, failed }: { pending: boolean; failed: boolean }) {
	const state = useRingTick(pending, failed);
	return state ? <RingTick state={state} /> : <span data-ring="none" />;
}

describe("RingTick (#1020)", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		vi.useFakeTimers();
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		vi.useRealTimers();
	});
	const ring = () =>
		host.querySelector("[data-ring]")?.getAttribute("data-ring");
	const show = (pending: boolean, failed = false) =>
		act(() => root.render(<Probe pending={pending} failed={failed} />));

	it("shows nothing before any work", () => {
		show(false);
		expect(ring()).toBe("none");
	});

	it("rings while pending, then a still tick that goes after a moment", () => {
		show(true);
		expect(ring()).toBe("busy");
		expect(host.querySelector(".ring-spin")).not.toBeNull();
		show(false);
		expect(ring()).toBe("done");
		expect(host.querySelector(".tick-pop")).not.toBeNull();
		act(() => vi.advanceTimersByTime(SETTLE_MS));
		expect(ring()).toBe("none");
	});

	it("ends in a cross when the work failed, and rings again on a retry", () => {
		show(true);
		show(false, true);
		expect(ring()).toBe("failed");
		show(true, true);
		expect(ring()).toBe("busy");
	});
});
