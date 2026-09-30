// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { dropAction } from "./board-drop";

const drop = (
	from: Parameters<typeof dropAction>[0]["from"],
	to: Parameters<typeof dropAction>[0]["to"],
	opts: { live?: boolean; canResolve?: boolean } = {},
) =>
	dropAction({
		from,
		to,
		live: opts.live ?? false,
		canResolve: opts.canResolve ?? true,
	});

describe("dropAction", () => {
	it("investigates whatever lands in Working", () => {
		expect(drop("needs_you", "working")).toEqual({ kind: "investigate" });
		expect(drop("concluded", "working")).toEqual({ kind: "investigate" });
		expect(drop("resolved", "working", { canResolve: false })).toEqual({
			kind: "investigate",
		});
	});

	it("stops a run dropped from Working on Concluded", () => {
		expect(drop("working", "concluded", { live: true })).toEqual({
			kind: "stop",
		});
	});

	it("resolves, stopping a live run first", () => {
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

	it("refuses Needs you, leaving Resolved sideways, and a drop in place", () => {
		expect(drop("concluded", "needs_you").kind).toBe("none");
		expect(drop("working", "needs_you").kind).toBe("none");
		expect(drop("resolved", "needs_you").kind).toBe("none");
		expect(drop("resolved", "concluded").kind).toBe("none");
		expect(drop("needs_you", "concluded").kind).toBe("none");
		expect(drop("working", "working")).toEqual({ kind: "none" });
		expect(drop("needs_you", "resolved", { canResolve: false }).kind).toBe(
			"none",
		);
	});

	it("gives a one-line reason for every refused move", () => {
		for (const [from, to] of [
			["concluded", "needs_you"],
			["resolved", "concluded"],
			["needs_you", "concluded"],
		] as const) {
			const action = drop(from, to);
			expect(action.kind === "none" && action.reason).toBeTruthy();
		}
	});
});
