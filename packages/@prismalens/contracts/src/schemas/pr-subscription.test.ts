// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	defaultSpec,
	resolveSpec,
	subscriptionSummary,
} from "./pr-subscription.js";

describe("resolveSpec", () => {
	it("refuses a misspelled filter part instead of dropping it for the default", () => {
		expect(() =>
			resolveSpec("user", {
				filter: { author: { minAssociation: "owner" } },
			} as never),
		).toThrow();
	});

	it("refuses a misspelled top-level field instead of dropping it for the default", () => {
		expect(() =>
			resolveSpec("agent", { events: ["comments"], delivry: "batch" } as never),
		).toThrow();
	});

	it("still merges a known filter part over the creator's defaults", () => {
		const spec = resolveSpec("user", {
			filter: { authors: { minAssociation: "owner" } },
		});
		expect(spec.filter.authors.minAssociation).toBe("owner");
		expect(spec.filter.authors.bots).toBe(
			defaultSpec("user").filter.authors.bots,
		);
	});
});

describe("subscriptionSummary", () => {
	it("names a checks-only subscription that selects no check events", () => {
		const spec = resolveSpec("user", {
			events: ["checks"],
			filter: { checks: { conclusions: [], summary: false } },
		});
		expect(subscriptionSummary(spec)).toBe(
			"No events selected. Wakes the thread.",
		);
	});
});
