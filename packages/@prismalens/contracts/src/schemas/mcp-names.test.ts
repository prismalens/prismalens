// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	allocateOfferedNames,
	OFFERED_NAME_MAX,
	OFFERED_NAME_RE,
	validateConnectionName,
} from "./mcp-names.js";

const offered = (
	upstream: string[],
	reserved: Iterable<string> = [],
	connection = "n8n_prod",
) =>
	Object.fromEntries(
		[...allocateOfferedNames(connection, upstream, new Set(reserved))].map(
			([k, v]) => [k, v.offered],
		),
	);

describe("allocateOfferedNames (#848, OBJ-015)", () => {
	it("prefixes a plain name with the connection", () => {
		expect(
			allocateOfferedNames("n8n_prod", ["list_workflows"], new Set()).get(
				"list_workflows",
			),
		).toEqual({ offered: "n8n_prod__list_workflows", shortened: false });
	});

	it("keeps two long names that share a prefix distinct and within the limit", () => {
		const a = `${"a".repeat(60)}3644`;
		const b = `${"a".repeat(60)}7669`;
		const names = offered([a, b]);
		expect(names[a]).not.toBe(names[b]);
		for (const n of Object.values(names))
			expect(n.length).toBeLessThanOrEqual(OFFERED_NAME_MAX);
	});

	it("keeps sanitised twins distinct, whatever the catalogue order", () => {
		const list = ["a.b", "a_b", "a_b_2e7336"];
		const forward = offered(list);
		expect(new Set(Object.values(forward)).size).toBe(3);
		expect(offered([...list].reverse())).toEqual(forward);
	});

	it("renames a tool that collides with a reserved name", () => {
		const names = offered(["sources_list"], ["n8n_prod__sources_list"]);
		expect(names.sources_list).not.toBe("n8n_prod__sources_list");
		expect(names.sources_list).toMatch(/^n8n_prod__sources_list_[0-9a-f]{6}$/);
	});

	it("falls back to t<n> when every hash length is taken", () => {
		const first = allocateOfferedNames("x", ["tool"], new Set());
		const plain = first.get("tool")?.offered ?? "";
		const taken = new Set([plain]);
		for (const n of [6, 8, 10]) {
			const once = allocateOfferedNames("x", ["tool"], taken);
			taken.add(once.get("tool")?.offered ?? "");
			expect(once.get("tool")?.offered).toMatch(new RegExp(`_[0-9a-f]{${n}}$`));
		}
		expect(offered(["tool"], taken, "x").tool).toBe("x__t1");
	});

	it("only ever offers names every agent accepts", () => {
		const weird = ["héllo wörld", "a/b/c", "-dash", "x".repeat(200), "1abc", "ok"];
		for (const n of Object.values(offered(weird)))
			expect(n).toMatch(OFFERED_NAME_RE);
	});
});

describe("validateConnectionName (#848)", () => {
	it("accepts a valid name and refuses what CONNECTION_NAME refuses", () => {
		expect(validateConnectionName("n8n_prod", [])).toBeNull();
		for (const bad of ["n8n__prod", "N8n", "1n8n", "a".repeat(17), ""])
			expect(validateConnectionName(bad, [])).not.toBeNull();
	});

	it("refuses a name another connection holds, ignoring case", () => {
		expect(validateConnectionName("n8n_prod", ["N8N_PROD"])).not.toBeNull();
	});
});
