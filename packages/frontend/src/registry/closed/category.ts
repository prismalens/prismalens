// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

interface Category {
	title: string;
	area: string;
	/**
	 * The survey folder of reference screens a judge compares it with, or "none" when the
	 * survey has no shot of it; `judge-pack` refuses a kit that has neither (#1101 Scores).
	 */
	reference: string;
	/**
	 * Design-matrix shot names that show it, by prefix (`*-390-` matches every phone shot);
	 * `pnpm sim judge-evidence` puts them beside the reference. Empty: only a walk shows it.
	 */
	shots: readonly string[];
}

/** #1101's scored categories, by number; `pnpm registry render bar` writes its index from here. */
export const categories = defineClosed(
	"category",
	[
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"7",
		"8",
		"9",
		"10",
		"11",
		"12",
		"13",
		"14",
		"15",
		"16",
		"17",
		"18",
		"19",
		"20",
		"21",
		"22",
		"23",
	] as const,
	{
		"1": {
			title: "Thread list",
			area: "Threads and attention",
			reference: "01-thread-list",
			shots: [
				"sidebar-sections",
				"sidebar-waiting",
				"many-board",
				"chats-home",
				"new",
				"one-service-home",
				"hover-row",
				"focus-row",
			],
		},
		"2": {
			title: "Thread statuses",
			area: "Threads and attention",
			reference: "01-thread-list",
			shots: [
				"failed",
				"live-run",
				"chat-running",
				"finished",
				"ask-thread",
				"stop-",
				"sidebar-waiting",
			],
		},
		"3": {
			title: "Away view and catching up",
			area: "Threads and attention",
			reference: "10-away-and-notifications",
			shots: ["away-board"],
		},
		"4": {
			title: "Notifications",
			area: "Threads and attention",
			reference: "10-away-and-notifications",
			shots: ["notify-"],
		},
		"5": {
			title: "Phone (web page at 390 px)",
			area: "Threads and attention",
			reference: "none",
			shots: ["*-390-"],
		},
		"6": {
			title: "Composer menus",
			area: "Composer and asks",
			reference: "02-composer-menus",
			shots: ["picker-", "hover-send", "empty-home"],
		},
		"7": {
			title: "Chips, attachments and editing keys",
			area: "Composer and asks",
			reference: "02-composer-menus",
			shots: ["chats-home", "empty-home"],
		},
		"8": {
			title: "Asks and approvals, including from another thread",
			area: "Composer and asks",
			reference: "09-asks-approvals",
			shots: ["ask-thread", "sidebar-waiting", "approval"],
		},
		"9": {
			title: "Tool rows",
			area: "Transcript",
			reference: "03-tool-rows",
			shots: ["live-run", "chat-finished", "tool-line-", "frames-live"],
		},
		"10": {
			title: "Sub-agents, threads that start threads, and messages",
			area: "Transcript",
			reference: "04-subagents",
			shots: ["webhook-thread"],
		},
		"11": {
			title: "Context",
			area: "Transcript",
			reference: "06-context",
			shots: ["chat-finished"],
		},
		"12": {
			title: "Long threads on a patchy network",
			area: "Transcript",
			reference: "13-extras",
			shots: ["thread-long", "thread-page-retry", "thread-new-reconnecting"],
		},
		"13": {
			title: "Transcript find",
			area: "Transcript",
			reference: "13-extras",
			shots: ["thread-find-"],
		},
		"14": {
			title: "Transcript rail",
			area: "Transcript",
			reference: "13-extras",
			shots: ["thread-rail-hover", "rail-focus", "thread-long"],
		},
		"15": {
			title: "PR and checks",
			area: "Work products",
			reference: "07-pr-and-checks",
			shots: [],
		},
		"16": {
			title: "Diff and files",
			area: "Work products",
			reference: "08-diff-and-files",
			shots: [],
		},
		"17": {
			title: "Usage and limits, including API-key failures",
			area: "Limits, settings and the rest",
			reference: "05-limits-and-usage",
			shots: ["usage-", "stop-"],
		},
		"18": {
			title: "Settings",
			area: "Limits, settings and the rest",
			reference: "12-settings",
			shots: ["settings"],
		},
		"19": {
			title: "Command palette",
			area: "Limits, settings and the rest",
			reference: "13-extras",
			shots: ["palette"],
		},
		"20": {
			title: "Thread menu",
			area: "Limits, settings and the rest",
			reference: "13-extras",
			shots: ["menu-action", "menu-context-open"],
		},
		"21": {
			title: "Terminal, browser and files panes",
			area: "Limits, settings and the rest",
			reference: "08-diff-and-files",
			shots: ["incident-panel"],
		},
		"22": {
			title: "Scheduled tasks",
			area: "Limits, settings and the rest",
			reference: "13-extras",
			shots: ["automation-page", "schedule-run"],
		},
		"23": {
			title: "Error notices",
			area: "Limits, settings and the rest",
			reference: "05-limits-and-usage",
			shots: ["failed", "stop-", "error-board", "thread-page-retry"],
		},
	} satisfies Record<string, Category>,
);

export type CategoryId = (typeof categories.members)[number];
