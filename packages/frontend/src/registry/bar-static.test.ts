// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PL_SERVER_NAME, PL_TOOLS } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { allSettings, surfaceById } from "@/components/kit/registry";
import { STATUS_DEFS } from "@/components/kit/Status";
import { stopCause } from "@/lib/stop-causes";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import { barItems } from "./closed/bar-item";

// The bar items the registry proves without running the app (#1101 Scores, bar checks).
// Each test's name starts with its item id: `pnpm sim judge-evidence` reads the ids from
// vitest's json report into checks.md.

const BAR_WORDS = [
	"Approval needed",
	"Question",
	"Blocked",
	"Failed",
	"Limited",
	"Working",
	"Waiting",
	"Done",
];

const STATIC = {
	"2.1": "each of the eight bar status words is one closed-set member with a shape and a tint",
	"9.2": "the MCP server is prismalens and every PL_TOOLS entry is pl_* with a step label",
	"17.7": "each API-key mode in stopCauses has the table's words, its action and its resume rule",
	"18.2": "Settings has the bar's pages, each with the rows the bar names",
	"20.1": "the row's ⋯ and right-click and the header's ⋯ list the same thread actions in one order",
} as const;

describe("bar items proved by the registry", () => {
	it("every static bar item has a test here, and only those", () => {
		const marked = barItems.members.filter(
			(id) => barItems.get(id).mark === "static",
		);
		expect(Object.keys(STATIC).sort()).toEqual([...marked].sort());
	});

	it(`2.1 ${STATIC["2.1"]}`, () => {
		const defs = Object.values(STATUS_DEFS);
		const got = BAR_WORDS.map((w) => {
			const d = defs.filter((x) => x.word === w);
			// Working draws the accent ring instead of an icon.
			return `${w}:${d.length}:${d[0] && (d[0].Icon || w === "Working") ? "shape" : "none"}:${d[0]?.icon.startsWith("text-") ? "tint" : "none"}`;
		});
		expect(got).toEqual(BAR_WORDS.map((w) => `${w}:1:shape:tint`));
	});

	it(`9.2 ${STATIC["9.2"]}`, () => {
		expect(PL_SERVER_NAME).toBe("prismalens");
		const bad = Object.values(PL_TOOLS).filter(
			(t) => !/^pl_[a-z_]+$/.test(t.name) || !/^[A-Z]/.test(t.label.step),
		);
		expect(bad.map((t) => t.name)).toEqual([]);
	});

	it(`17.7 ${STATIC["17.7"]}`, () => {
		const row = (c: Parameters<typeof stopCause>[0]) => {
			const v = stopCause(c);
			return {
				state: v.state,
				line: v.line?.("Claude Code") ?? v.head,
				account: v.account?.word ?? null,
				fix: v.fix ?? null,
				retries: !!v.retries,
			};
		};
		expect({
			out_of_credit: row("out_of_credit"),
			rate_limited: row("rate_limited"),
			key_rejected: row("key_rejected"),
			spend_cap: row("spend_cap"),
			overloaded: row("overloaded"),
		}).toEqual({
			out_of_credit: {
				state: "blocked",
				line: "Claude Code is out of credit on its API account",
				account: "Add credit",
				fix: "needs.addCredit",
				retries: false,
			},
			rate_limited: {
				state: "limited",
				line: "Claude Code's provider limited the request rate",
				account: null,
				fix: null,
				retries: true,
			},
			key_rejected: {
				state: "blocked",
				line: "Claude Code's API key was rejected",
				account: null,
				fix: "needs.updateKey",
				retries: false,
			},
			spend_cap: {
				state: "blocked",
				line: "Your organization's spend cap was reached",
				account: "Raise the cap",
				fix: "needs.raiseCap",
				retries: false,
			},
			overloaded: {
				state: "limited",
				line: "Claude Code's provider was busy",
				account: null,
				fix: null,
				retries: true,
			},
		});
	});

	it(`18.2 ${STATIC["18.2"]}`, () => {
		const tabs: string[] = SETTINGS_SECTIONS.map((s) => s.tab);
		const ids = new Set<string>(allSettings().map((s) => s.id));
		const want = {
			tabs: [
				"models",
				"permissions",
				"organizer",
				"agent",
				"appearance",
				"notifications",
				"shortcuts",
			],
			rows: [
				"models.newThread",
				"models.alertRun",
				"models.organizer",
				"models.delegate",
				"permissions.permissionLevels",
				"permissions.defaultPermissionPerAgent",
				"permissions.whenAnAlertRunAsks",
				"organizer.agentsMayStartThreads",
				"organizer.perStarter",
				"organizer.atOnce",
				"organizer.perDay",
				"organizer.pairPerDay",
			],
		};
		expect({
			tabs: want.tabs.filter((t) => tabs.includes(t)),
			rows: want.rows.filter((r) => ids.has(r)),
		}).toEqual(want);
	});

	it(`20.1 ${STATIC["20.1"]}`, () => {
		const row = surfaceById("thread.row")?.menus;
		const header = surfaceById("thread.header")?.menus.more ?? [];
		const more: readonly string[] = row?.more ?? [];
		// The header folds its own controls in first, then the row's full set.
		const tail = header.slice(header.length - more.length);
		expect({ context: row?.context, header: tail }).toEqual({
			context: more,
			header: more,
		});
		const bar = [
			"thread.rename",
			"thread.pin",
			"thread.fork",
			"thread.aside",
			"thread.settle",
			"thread.archive",
			"thread.worktree",
			"thread.link",
			"thread.transcript",
		];
		expect(bar.filter((id) => !more.includes(id))).toEqual([]);
	});
});
