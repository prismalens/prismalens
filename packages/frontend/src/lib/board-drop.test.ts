// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	acknowledgesFirst,
	columnBeside,
	dropAction,
	dropWord,
} from "./board-drop";
import type { BoardColumn } from "./incident-board";

const drop = (
	from: Parameters<typeof dropAction>[0]["from"],
	to: Parameters<typeof dropAction>[0]["to"],
	opts: {
		live?: boolean;
		canResolve?: boolean;
		canReopen?: boolean;
		canAcknowledge?: boolean;
		mergedInto?: number;
	} = {},
) =>
	dropAction({
		from,
		to,
		live: opts.live ?? false,
		canResolve: opts.canResolve ?? true,
		canReopen: opts.canReopen ?? false,
		canAcknowledge: opts.canAcknowledge ?? false,
		mergedInto: opts.mergedInto ?? null,
	});

describe("dropAction", () => {
	it("starts a run on whatever open card lands in Working, with no form", () => {
		expect(drop("needs_you", "working")).toEqual({
			kind: "investigate",
			acknowledge: false,
		});
		expect(drop("concluded", "working")).toEqual({
			kind: "investigate",
			acknowledge: false,
		});
	});

	it("acknowledges and starts a run when Triggered card dropped on Working", () => {
		expect(
			drop("needs_you", "working", { canAcknowledge: true }),
		).toEqual({ kind: "investigate", acknowledge: true });
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

	it("reopens a Resolved card dropped on Concluded even if live", () => {
		expect(
			drop("resolved", "concluded", {
				canResolve: false,
				canReopen: true,
				live: true,
			}),
		).toEqual({ kind: "reopen" });
	});

	it("acknowledges a live card dropped on Working if canAcknowledge", () => {
		expect(drop("needs_you", "working", { live: true, canAcknowledge: true })).toEqual({
			kind: "acknowledge",
		});
	});

	it("refuses a second run while one is live without canAcknowledge", () => {
		expect(drop("needs_you", "working", { live: true })).toEqual({
			kind: "none",
			reason: "Its run is already working",
		});
	});

	it("stops a live run dropped on Concluded from any column", () => {
		expect(drop("working", "concluded", { live: true })).toEqual({
			kind: "stop",
		});
		expect(drop("needs_you", "concluded", { live: true })).toEqual({
			kind: "stop",
		});
	});

	it("refuses a non-live card dropped from needs_you to Concluded", () => {
		expect(drop("needs_you", "concluded")).toEqual({
			kind: "none",
			reason: "Concluded follows from a finished investigation",
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

describe("dropWord", () => {
	it("says what dropping on each kind of action would do (#673 walk 4)", () => {
		expect(dropWord({ kind: "investigate", acknowledge: false })).toBe(
			"drop to start a run",
		);
		expect(dropWord({ kind: "investigate", acknowledge: true })).toBe(
			"drop to acknowledge it and start a run",
		);
		expect(dropWord({ kind: "acknowledge" })).toBe("drop to acknowledge it");
		expect(dropWord({ kind: "reopen-investigate" })).toBe(
			"drop to reopen it and start a run",
		);
		expect(dropWord({ kind: "reopen" })).toBe("drop to reopen it");
		expect(dropWord({ kind: "stop" })).toBe("drop to stop its run");
		expect(dropWord({ kind: "resolve", stopFirst: false })).toBe(
			"drop to resolve it",
		);
		expect(dropWord({ kind: "resolve", stopFirst: true })).toBe(
			"drop to stop its run and resolve it",
		);
		expect(dropWord({ kind: "none", reason: "Its run is already working" })).toBe(
			"Its run is already working",
		);
		expect(dropWord({ kind: "none" })).toBe("dropping here changes nothing");
	});
});

describe("columnBeside", () => {
	const order: readonly BoardColumn[] = [
		"needs_you",
		"working",
		"concluded",
		"resolved",
	];

	it("moves to the next column on ArrowRight and stops at the end (#673 walk 4)", () => {
		expect(columnBeside("ArrowRight", "needs_you", order)).toBe("working");
		expect(columnBeside("ArrowRight", "working", order)).toBe("concluded");
		expect(columnBeside("ArrowRight", "concluded", order)).toBe("resolved");
		expect(columnBeside("ArrowRight", "resolved", order)).toBeNull();
	});

	it("moves to the previous column on ArrowLeft and stops at the beginning (#673 walk 4)", () => {
		expect(columnBeside("ArrowLeft", "resolved", order)).toBe("concluded");
		expect(columnBeside("ArrowLeft", "concluded", order)).toBe("working");
		expect(columnBeside("ArrowLeft", "working", order)).toBe("needs_you");
		expect(columnBeside("ArrowLeft", "needs_you", order)).toBeNull();
	});

	it("returns null for any key other than ArrowRight and ArrowLeft (#673 walk 4)", () => {
		expect(columnBeside("Space", "working", order)).toBeNull();
		expect(columnBeside("Enter", "working", order)).toBeNull();
		expect(columnBeside("Escape", "working", order)).toBeNull();
		expect(columnBeside("ArrowUp", "working", order)).toBeNull();
		expect(columnBeside("ArrowDown", "working", order)).toBeNull();
	});
});


describe("acknowledgesFirst (#805)", () => {
	it("acknowledges a Triggered card only when a run can start", () => {
		const action = { kind: "investigate", acknowledge: true } as const;
		expect(acknowledgesFirst(action, true)).toBe(true);
		expect(acknowledgesFirst(action, false)).toBe(false);
	});

	it("never acknowledges a card that needs none", () => {
		const action = { kind: "investigate", acknowledge: false } as const;
		expect(acknowledgesFirst(action, true)).toBe(false);
	});
});
