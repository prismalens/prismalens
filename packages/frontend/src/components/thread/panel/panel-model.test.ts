// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type PanelTab,
	panelSearchOf,
	panelTabs,
	shownTab,
} from "./panel-model";

describe("panelTabs (#1024)", () => {
	it.each([
		[
			"incident",
			[
				{ id: "kind", label: "Incident" },
				{ id: "thread", label: "Thread" },
				{ id: "changes", label: "Changes" },
			],
		],
		[
			"schedule",
			[
				{ id: "kind", label: "Runs" },
				{ id: "thread", label: "Thread" },
				{ id: "changes", label: "Changes" },
			],
		],
		[
			"service",
			[
				{ id: "kind", label: "Service" },
				{ id: "thread", label: "Thread" },
				{ id: "changes", label: "Changes" },
			],
		],
		[
			"project",
			[
				{ id: "kind", label: "Project" },
				{ id: "thread", label: "Thread" },
				{ id: "changes", label: "Changes" },
			],
		],
		[
			"none",
			[
				{ id: "thread", label: "Thread" },
				{ id: "changes", label: "Changes" },
			],
		],
	] as const)(
		"panelTabs exact list for kind %s with thread:true, changes:true, browser:false",
		(kind, expected) => {
			expect(
				panelTabs({
					kind,
					thread: true,
					changes: true,
					browser: false,
				}),
			).toEqual(expected);
		},
	);

	it("drops Changes when changes is false", () => {
		expect(
			panelTabs({
				kind: "incident",
				thread: true,
				changes: false,
				browser: false,
			}),
		).toEqual([
			{ id: "kind", label: "Incident" },
			{ id: "thread", label: "Thread" },
		]);
	});

	it("appends Browser when browser is true", () => {
		expect(
			panelTabs({
				kind: "incident",
				thread: true,
				changes: true,
				browser: true,
			}),
		).toEqual([
			{ id: "kind", label: "Incident" },
			{ id: "thread", label: "Thread" },
			{ id: "changes", label: "Changes" },
			{ id: "browser", label: "Browser" },
		]);
	});
});

describe("panelSearchOf (#1024)", () => {
	it("keeps valid panel, section, path, and line", () => {
		expect(
			panelSearchOf({
				panel: "changes",
				section: "plan",
				path: "src/a.ts",
				line: 12,
			}),
		).toEqual({
			panel: "changes",
			section: "plan",
			path: "src/a.ts",
			line: 12,
		});
	});

	it("drops panel bogus, line 0, and line x", () => {
		expect(
			panelSearchOf({
				panel: "bogus",
				line: "0",
			}),
		).toEqual({});

		expect(
			panelSearchOf({
				line: "x",
			}),
		).toEqual({});
	});
});

describe("shownTab (#1024)", () => {
	it("falls back to the first tab when the asked tab is missing or undefined", () => {
		const tabs: PanelTab[] = [
			{ id: "thread", label: "Thread" },
			{ id: "changes", label: "Changes" },
		];
		expect(shownTab(tabs, undefined)).toBe("thread");
		expect(shownTab(tabs, "browser")).toBe("thread");
		expect(shownTab(tabs, "changes")).toBe("changes");
	});
});
