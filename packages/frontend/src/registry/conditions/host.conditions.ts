// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const hostStandby = define.condition({
	id: "host.standby",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote:
			"the laptop was still on and your cron did not fire since 2pm IST something",
		where: "operator, organizer session, 2026-11-11 11:00Z",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["12", "23", "3", "5"] },
	simulator: "clock.standby",
	profile: {
		wakeDelayS: 600,
		skipMs: 660000,
	},
	stage: {
		run: "node scripts/fakes/conditions/standby.mjs stage --url {url} --prove",
		live: "the thread Watch the rollout, with a wake 10 minutes out; Watch the canary already slept through one skip",
	},
	trigger: {
		run: "node scripts/fakes/conditions/standby.mjs skip --url {url}",
		on: "button",
	},
	measure: [
		{
			state:
				"after a clock skip, PrismaLens's own timers fire late and exactly once",
		},
		{
			state:
				"reconnect without a reload, a delta-only replay, and the away card",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const hostRestart = define.condition({
	id: "host.restart",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			'Restart or upgrade mid-run | 23, 17, 12, 14 | "Interrupted by restart" with Resume, the limit time and queue kept, no double resume',
		where: "#1101 bar",
	},
	appliesTo: {
		walks: ["restart-resume"],
		categories: ["23", "17", "12", "14", "2"],
	},
	simulator: "host.restart",
	profile: { threads: 2 },
	measure: [
		{
			state:
				"Interrupted by restart with Resume, the limit time and queue kept, no double resume; each limit variant again across a restart",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/conditions/host-restart.mjs --url {url}",
		live: "the thread Rebuild the search index, Interrupted with Resume after the server restarted mid-turn (Resume after a restart is off in Settings for this run)",
		order: "first",
	},
});
