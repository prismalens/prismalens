// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

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
		"1": { title: "Thread list", area: "Threads and attention" },
		"2": { title: "Thread statuses", area: "Threads and attention" },
		"3": { title: "Away view and catching up", area: "Threads and attention" },
		"4": { title: "Notifications", area: "Threads and attention" },
		"5": { title: "Phone (web page at 390 px)", area: "Threads and attention" },
		"6": { title: "Composer menus", area: "Composer and asks" },
		"7": {
			title: "Chips, attachments and editing keys",
			area: "Composer and asks",
		},
		"8": {
			title: "Asks and approvals, including from another thread",
			area: "Composer and asks",
		},
		"9": { title: "Tool rows", area: "Transcript" },
		"10": {
			title: "Sub-agents, threads that start threads, and messages",
			area: "Transcript",
		},
		"11": { title: "Context", area: "Transcript" },
		"12": { title: "Long threads on a patchy network", area: "Transcript" },
		"13": { title: "Transcript find", area: "Transcript" },
		"14": { title: "Transcript rail", area: "Transcript" },
		"15": { title: "PR and checks", area: "Work products" },
		"16": { title: "Diff and files", area: "Work products" },
		"17": {
			title: "Usage and limits, including API-key failures",
			area: "Limits, settings and the rest",
		},
		"18": { title: "Settings", area: "Limits, settings and the rest" },
		"19": { title: "Command palette", area: "Limits, settings and the rest" },
		"20": { title: "Thread menu", area: "Limits, settings and the rest" },
		"21": {
			title: "Terminal, browser and files panes",
			area: "Limits, settings and the rest",
		},
		"22": { title: "Scheduled tasks", area: "Limits, settings and the rest" },
		"23": { title: "Error notices", area: "Limits, settings and the rest" },
	},
);

export type CategoryId = (typeof categories.members)[number];
