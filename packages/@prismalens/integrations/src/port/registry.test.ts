// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SourceRegistry } from "./registry.js";
import { type SourceTool, SourceToolRefused } from "./source-tool.js";

const ctx = { runId: "r1", signal: new AbortController().signal };

function tool(over: Partial<SourceTool> = {}): SourceTool {
	return {
		name: "prometheus_query",
		title: "t",
		description: "d",
		input: z.object({ query: z.string() }),
		category: "metrics",
		openWorld: true,
		run: async (input) => ({ value: input }),
		...over,
	};
}

describe("SourceRegistry (#848)", () => {
	it("refuses an invalid or duplicate name", () => {
		const r = new SourceRegistry();
		r.register(tool());
		for (const bad of [
			tool(),
			tool({ name: "n8n_prod__list" }),
			tool({ name: "Bad-Name" }),
		])
			expect(() => r.register(bad)).toThrow(SourceToolRefused);
		expect(r.list().map((t) => t.name)).toEqual(["prometheus_query"]);
	});

	it("answers an unknown name, bad input and a throw as isError, never throwing", async () => {
		const r = new SourceRegistry(() => "PrismaLens's own reason");
		r.register(tool());
		r.register(
			tool({
				name: "loki_query_range",
				category: "logs",
				run: async () => {
					throw new Error("upstream said secret-123");
				},
			}),
		);
		expect(await r.call("nope", {}, ctx)).toEqual({
			isError: true,
			value: { error: "No such PrismaLens tool" },
		});
		expect((await r.call("prometheus_query", { query: 1 }, ctx)).isError).toBe(
			true,
		);
		expect(await r.call("loki_query_range", { query: "x" }, ctx)).toEqual({
			isError: true,
			value: { error: "PrismaLens's own reason" },
		});
		expect(await r.call("prometheus_query", { query: "up" }, ctx)).toEqual({
			value: { query: "up" },
		});
	});

	it("lists names by category", () => {
		const r = new SourceRegistry();
		r.register(tool());
		r.register(tool({ name: "loki_query_range", category: "logs" }));
		expect(r.byCategory("logs")).toEqual(["loki_query_range"]);
	});
});
