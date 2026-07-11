// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { createCapsGate } from "./caps.js";

describe("CapsGate", () => {
	it("allows dispatch when no caps are set", () => {
		const gate = createCapsGate();
		const decision = gate.tryDispatch({}, 1000);
		expect(decision).toEqual({ allow: true });
		expect(gate.activeCount).toBe(1);
	});

	it("respects maxConcurrent cap", () => {
		const gate = createCapsGate();
		const caps = { maxConcurrent: 1 };

		expect(gate.tryDispatch(caps, 1000)).toEqual({ allow: true });
		expect(gate.tryDispatch(caps, 1001)).toEqual({
			allow: false,
			reason: "concurrency",
		});

		gate.release();
		expect(gate.tryDispatch(caps, 1002)).toEqual({ allow: true });
	});

	it("respects maxPerHour cap with sliding window", () => {
		const gate = createCapsGate();
		const caps = { maxPerHour: 3 };

		expect(gate.tryDispatch(caps, 0)).toEqual({ allow: true });
		expect(gate.tryDispatch(caps, 100)).toEqual({ allow: true });
		expect(gate.tryDispatch(caps, 200)).toEqual({ allow: true });

		expect(gate.tryDispatch(caps, 300)).toEqual({
			allow: false,
			reason: "per_hour",
		});

		// Advance past 1 hour from t=0
		expect(gate.tryDispatch(caps, 3_600_001)).toEqual({ allow: true });
	});

	it("prioritizes concurrency cap over per_hour cap", () => {
		const gate = createCapsGate();
		const caps = { maxConcurrent: 1, maxPerHour: 3 };

		expect(gate.tryDispatch(caps, 1000)).toEqual({ allow: true });
		expect(gate.tryDispatch(caps, 1001)).toEqual({
			allow: false,
			reason: "concurrency",
		});
	});

	it("handles a simulated storm shape", () => {
		const gate = createCapsGate();
		const caps = { maxConcurrent: 1, maxPerHour: 3 };

		// Attempt 1: allowed, starts = [0], active = 1
		expect(gate.tryDispatch(caps, 0)).toEqual({ allow: true });

		// Attempt 2: suppressed by concurrency (still active)
		expect(gate.tryDispatch(caps, 10)).toEqual({
			allow: false,
			reason: "concurrency",
		});

		gate.release();
		// active = 0

		// Attempt 3: allowed, starts = [0, 20], active = 1
		expect(gate.tryDispatch(caps, 20)).toEqual({ allow: true });
		gate.release();

		// Attempt 4: allowed, starts = [0, 20, 30], active = 1
		expect(gate.tryDispatch(caps, 30)).toEqual({ allow: true });
		gate.release();

		// Attempt 5: suppressed by per_hour
		expect(gate.tryDispatch(caps, 40)).toEqual({
			allow: false,
			reason: "per_hour",
		});

		// Attempt 6: suppressed by per_hour
		expect(gate.tryDispatch(caps, 50)).toEqual({
			allow: false,
			reason: "per_hour",
		});

		// Later... one falls out of window
		expect(gate.tryDispatch(caps, 3_600_001)).toEqual({ allow: true });
	});
});
