// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { dropAction } from "./board-drop";

const drop = (
	from: Parameters<typeof dropAction>[0]["from"],
	to: Parameters<typeof dropAction>[0]["to"],
	opts: {
		live?: boolean;
		canResolve?: boolean;
		canReopen?: boolean;
		mergedInto?: number;
	} = {},
) =>
	dropAction({
		from,
		to,
		live: opts.live ?? false,
		canResolve: opts.canResolve ?? true,
		canReopen: opts.canReopen ?? false,
		mergedInto: opts.mergedInto ?? null,
	});

describe("dropAction", () => {
	it("starts a run on whatever open card lands in Working, with no form", () => {
		expect(drop("needs_you", "working")).toEqual({ kind: "investigate" });
		expect(drop("concluded", "working")).toEqual({ kind: "investigate" });
	});

	it("asks to reopen a Resolved card dropped on Working (R1a d4)", () => {
		expect(
			drop("resolved", "working", { canResolve: false, canReopen: true }),
		).toEqual({ kind: "reopen-investigate" });
	});

	it("asks to reopen a Resolved card dropped on Concluded, with no run (#673 w42)", () => {
		expect(
			drop("resolved", "concluded", { canResolve: false, canReopen: true }),
		).toEqual({ kind: "reopen" });
	});

	it("refuses a second run while one is live", () => {
		expect(drop("needs_you", "working", { live: true }).kind).toBe("none");
	});

	it("stops a run dropped from Working on Concluded", () => {
		expect(drop("working", "concluded", { live: true })).toEqual({
			kind: "stop",
		});
	});

	it("resolves in one step from any open column, stopping a live run first", () => {
		expect(drop("needs_you", "resolved")).toEqual({
			kind: "resolve",
			stopFirst: false,
		});
		expect(drop("concluded", "resolved")).toEqual({
			kind: "resolve",
			stopFirst: false,
		});
		expect(drop("working", "resolved", { live: true })).toEqual({
			kind: "resolve",
			stopFirst: true,
		});
	});

	it("refuses Needs you, a Resolved card sideways, and a drop in place, each with a reason", () => {
		for (const [from, to, opts] of [
			["concluded", "needs_you", {}],
			["working", "needs_you", {}],
			["resolved", "needs_you", { canReopen: true }],
			["needs_you", "concluded", {}],
			["needs_you", "resolved", { canResolve: false }],
		] as const) {
			const action = drop(from, to, opts);
			expect(action.kind, `${from} -> ${to}`).toBe("none");
			expect(action.kind === "none" && action.reason, `${from} -> ${to}`).toBeTruthy();
		}
		expect(drop("working", "working")).toEqual({ kind: "none" });
	});

	it("refuses every drop of a merged card, naming where it went (#673 w37)", () => {
		for (const to of ["working", "concluded", "needs_you"] as const) {
			expect(
				drop("resolved", to, { canResolve: false, canReopen: true, mergedInto: 4 }),
			).toEqual({ kind: "none", reason: "Merged into INC-4" });
		}
	});
});
