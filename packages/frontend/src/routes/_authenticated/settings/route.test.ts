// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { Route, legacySettingsTarget, validateSettingsSearch } from "./route";

// The router merges `{ ...raw, ...validated }`; the merge is what Settings reads.
const merged = (raw: Record<string, unknown>) => ({
	...raw,
	...validateSettingsSearch(raw),
});

describe("Settings tab search (w8-2)", () => {
	it("drops an unknown tab so Settings falls back to the default", () => {
		expect(merged({ tab: "nope" }).tab).toBeUndefined();
		expect(merged({ tab: 3 }).tab).toBeUndefined();
	});

	it("keeps a known tab", () => {
		expect(merged({ tab: "notifications" }).tab).toBe("notifications");
		expect(merged({ tab: "general" }).tab).toBe("general");
		expect(merged({ tab: "appearance" }).tab).toBe("appearance");
		expect(merged({ tab: "agent" }).tab).toBe("agent");
		expect(merged({ tab: "alert-intake" }).tab).toBe("alert-intake");
	});

	it("keeps a source only on Sources, for a coverage Fix (#848)", () => {
		expect(merged({ tab: "sources", source: "conn-7" }).source).toBe("conn-7");
		expect(merged({ tab: "general", source: "conn-7" }).source).toBeUndefined();
		expect(merged({ tab: "sources", source: 7 }).source).toBeUndefined();
		expect(merged({ tab: "sources", source: "" }).source).toBeUndefined();
	});

	it("sends a tab from before #848 to its new page", () => {
		expect(legacySettingsTarget("?tab=integrations")).toEqual({
			tab: "notifications",
		});
		expect(legacySettingsTarget("?tab=harness")).toEqual({
			tab: "agent",
		});
		expect(legacySettingsTarget("?tab=danger")).toEqual({
			tab: "about",
			hash: "danger-zone",
		});
	});

	it("redirects legacy tabs in beforeLoad", () => {
		const beforeLoad = Route.options.beforeLoad as (ctx: {
			location: { searchStr: string };
		}) => void;
		expect(() =>
			beforeLoad({ location: { searchStr: "?tab=integrations" } }),
		).toThrow();
		expect(() =>
			beforeLoad({ location: { searchStr: "?tab=harness" } }),
		).toThrow();
		expect(() =>
			beforeLoad({ location: { searchStr: "?tab=danger" } }),
		).toThrow();
		expect(() =>
			beforeLoad({ location: { searchStr: "?tab=general" } }),
		).not.toThrow();
	});
});

describe("Settings agent page search (#907)", () => {
	it("keeps a known agent only under the Agent tab", () => {
		expect(merged({ tab: "agent", agent: "codex" }).agent).toBe("codex");
		expect(merged({ tab: "agent", agent: "local" }).agent).toBe("local");
		expect(merged({ tab: "devices", agent: "codex" }).agent).toBeUndefined();
		expect(merged({ agent: "codex" }).agent).toBeUndefined();
		expect(merged({ tab: "agent", agent: "nope" }).agent).toBeUndefined();
	});
});

describe("Legacy agent links (#911)", () => {
	it("keeps the agent when ?tab=harness redirects to Agent", () => {
		expect(legacySettingsTarget("?tab=harness&agent=codex")).toEqual({
			tab: "agent",
			agent: "codex",
		});
		expect(legacySettingsTarget('?tab="harness"&agent="codex"')).toEqual({
			tab: "agent",
			agent: "codex",
		});
		expect(legacySettingsTarget("?tab=harness&agent=nope")).toEqual({
			tab: "agent",
		});
		const beforeLoad = Route.options.beforeLoad as (ctx: {
			location: { searchStr: string };
		}) => void;
		let thrown: unknown;
		try {
			beforeLoad({ location: { searchStr: "?tab=harness&agent=codex" } });
		} catch (e) {
			thrown = e;
		}
		expect(
			(thrown as { options?: { search?: unknown } }).options?.search,
		).toEqual({ tab: "agent", agent: "codex" });
	});
});
