// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { RunUsage } from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";
import { usageView } from "./run-usage";

describe("usageView", () => {
	it("returns placeholder text and null hint/cost when usage is null on a live run", () => {
		const view = usageView(null, { live: true });
		expect(view.hint).toBeNull();
		expect(view.cost).toBeNull();
		expect(view.row).toEqual({
			text: "Not reported",
			sub: "This session has sent no usage so far.",
		});
	});

	it("explains that no usage arrived for a finished run", () => {
		const view = usageView(null, { live: false });
		expect(view.hint).toBeNull();
		expect(view.cost).toBeNull();
		expect(view.row).toEqual({
			text: "Not reported",
			sub: "No usage arrived for this run. That is not zero.",
		});
	});

	it("formats reported tokens against context size with percentage and timestamp", () => {
		const at = "2026-10-10T14:32:00Z";
		const usage: RunUsage = {
			used: 92410,
			size: 200000,
			at,
		};
		const view = usageView(usage, { live: true });
		const hhmm = formatClock(at);

		expect(view.hint).toBe(
			`This session last reported 92,410 tokens of a 200,000-token context, at ${hhmm}.`,
		);
		expect(view.row.text).toBe("92,410 tokens");
		expect(view.row.sub.startsWith("46% of a 200,000-token context")).toBe(true);
		expect(view.row.sub).toBe(`46% of a 200,000-token context, last reported at ${hhmm}.`);
	});

	it("handles used tokens exceeding context size cleanly", () => {
		const usage: RunUsage = {
			used: 1240000,
			size: 400000,
			at: "2026-10-10T15:00:00Z",
		};
		const view = usageView(usage, { live: true });

		expect(view.row.sub).toContain("Reported against a 400,000-token context (310%)");
		expect(view.row.sub).toContain("shown as sent");
	});

	it("omits the context phrase when size is zero", () => {
		const at = "2026-10-10T16:45:00Z";
		const usage: RunUsage = {
			used: 50000,
			size: 0,
			at,
		};
		const view = usageView(usage, { live: true });
		const hhmm = formatClock(at);

		expect(view.hint).not.toContain("context");
		expect(view.hint).toBe(`This session last reported 50,000 tokens, at ${hhmm}.`);
		expect(view.row.sub).toBe(`Last reported at ${hhmm}.`);
	});

	it("formats cost when provided by the agent", () => {
		const usage: RunUsage = {
			used: 10000,
			size: 100000,
			at: "2026-10-10T12:00:00Z",
			cost: { amount: 1.369, currency: "USD" },
		};
		const view = usageView(usage, { live: false });

		expect(view.cost).toEqual({
			text: "1.37 USD",
			sub: "As reported with the usage. PrismaLens does not price runs.",
		});
	});

	it("names no model or agent in the hint", () => {
		const usage: RunUsage = {
			used: 15000,
			size: 50000,
			at: "2026-10-10T12:00:00Z",
		};
		const view = usageView(usage, { live: true });

		expect(view.hint).toMatch(/^This session last reported /);
	});
});
