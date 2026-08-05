// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * EventBus tests, weighted toward the two properties other code depends on: the
 * subscriber count (the cancel path's whole contract) and per-handler error isolation.
 */

import { describe, expect, it, vi } from "vitest";
import {
	InProcessEventBus,
	runCancelTopic,
	runEventsTopic,
} from "./event-bus.js";

describe("InProcessEventBus", () => {
	it("delivers to every subscriber and reports how many received", () => {
		const bus = new InProcessEventBus();
		const a = vi.fn();
		const b = vi.fn();
		bus.subscribe("t", a);
		bus.subscribe("t", b);

		expect(bus.publish("t", { n: 1 })).toBe(2);
		expect(a).toHaveBeenCalledWith({ n: 1 });
		expect(b).toHaveBeenCalledWith({ n: 1 });
	});

	it("reports ZERO receivers on an empty topic — the cancel path's fallback signal", () => {
		const bus = new InProcessEventBus();
		// No retention: a publish nobody heard means nobody will ever act on it, which is
		// exactly when the API must write the terminal state itself.
		expect(bus.publish(runCancelTopic("inv-1"), { kind: "cancel" })).toBe(0);
	});

	it("stops counting a subscriber once it unsubscribes", () => {
		const bus = new InProcessEventBus();
		const { unsubscribe } = bus.subscribe("t", vi.fn());
		expect(bus.subscriberCount("t")).toBe(1);

		unsubscribe();

		expect(bus.subscriberCount("t")).toBe(0);
		expect(bus.publish("t", {})).toBe(0);
	});

	it("isolates a throwing handler: the others still receive, and publish does not throw", () => {
		const bus = new InProcessEventBus();
		const errors: unknown[] = [];
		const after = vi.fn();
		bus.subscribe("t", () => {
			throw new Error("subscriber blew up");
		});
		bus.subscribe("t", after);

		expect(() =>
			bus.publish("t", { n: 1 }, (error) => errors.push(error)),
		).not.toThrow();

		expect(after).toHaveBeenCalledOnce();
		expect(errors).toHaveLength(1);
		// A handler that received the message and then threw still received it, so the
		// cancel path's receiver count must include it.
		expect(bus.publish("t", { n: 2 }, () => {})).toBe(2);
	});

	it("tolerates a handler that unsubscribes itself mid-delivery", () => {
		const bus = new InProcessEventBus();
		const later = vi.fn();
		const first = bus.subscribe("t", () => first.unsubscribe());
		bus.subscribe("t", later);

		expect(() => bus.publish("t", {})).not.toThrow();
		expect(later).toHaveBeenCalledOnce();
		expect(bus.subscriberCount("t")).toBe(1);
	});

	it("keeps run topics distinct per investigation", () => {
		const bus = new InProcessEventBus();
		const one = vi.fn();
		bus.subscribe(runEventsTopic("inv-1"), one);

		expect(bus.publish(runEventsTopic("inv-2"), { kind: "done" })).toBe(0);
		expect(one).not.toHaveBeenCalled();
	});
});
