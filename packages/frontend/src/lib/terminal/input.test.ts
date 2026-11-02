// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { TerminalClientFrameSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { chunkTerminalInput } from "./input";

const accepted = (d: string) =>
	TerminalClientFrameSchema.safeParse({ t: "in", d }).success;

describe("chunkTerminalInput (#931)", () => {
	it("sends typing as it is", () => {
		expect(chunkTerminalInput("ls\r")).toEqual(["ls\r"]);
		expect(chunkTerminalInput("")).toEqual([]);
	});

	it("splits a big paste into frames the socket's schema accepts, losing nothing", () => {
		const paste = "x".repeat(40_000);
		const chunks = chunkTerminalInput(paste);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every(accepted)).toBe(true);
		expect(chunks.join("")).toBe(paste);
	});

	it("never cuts an emoji in half at a boundary", () => {
		const paste = `${"x".repeat(16_383)}😀${"y".repeat(20_000)}`;
		const chunks = chunkTerminalInput(paste);
		expect(chunks.every(accepted)).toBe(true);
		expect(chunks.join("")).toBe(paste);
		for (const c of chunks) expect(c).toBe(c.toWellFormed());
	});
});
