// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const slowLink = define.condition({
	id: "net.slow-link",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote:
			"A spoty mobile internet. And with that criteria, they fixed and optimised anything that takes time",
		where: "operator, organizer session, 2026-11-11 15:35Z",
	},
	appliesTo: { walks: "all", categories: ["12", "5", "23"] },
	simulator: "net.throttle",
	profile: {
		rttMs: 400,
		downKbps: 1600,
		upKbps: 750,
		cpu: 4,
		drops: [{ atS: "mid", forS: 10 }],
	},
	measure: [
		{ metric: "thread.firstContent", max: 3000, unit: "ms" },
		{
			metric: "bytes.beforeFirstPaint",
			max: 500000,
			unit: "B",
			pages: [
				{
					page: "diff",
					max: 1000000,
					said: {
						date: "2026-11-13",
						quote: "at most 500 KB, 1 MB on the diff",
						where: "operator, #1101 finish list, 2026-11-13",
					},
				},
			],
		},
		{ metric: "connection.wordAfterDrop", max: 2000, unit: "ms" },
		// The request census (#1181): an idle tab while another thread's agent works ten calls a second.
		{ metric: "census.liveRequestsPerMin", max: 60, unit: "/min" },
		{ metric: "census.listLagMs", max: 2000, unit: "ms" },
		{ metric: "census.liveApiBytesPerMin", max: 100000, unit: "B" },
		{
			metric: "census.longLivedConnections",
			max: 1,
			pages: [
				{
					page: "thread.live",
					max: 2,
					said: {
						date: "2026-11-18",
						quote:
							"one change stream per browser, plus the watched live thread",
						where: "#1181 spec, §4",
					},
				},
				{
					page: "pool5h.direct",
					max: 2,
					said: {
						date: "2026-11-18",
						quote: "hidden tabs hold no transcript stream",
						where: "#1181 spec, §4",
					},
				},
				{
					page: "pool3.direct",
					max: 4,
					said: {
						date: "2026-11-18",
						quote:
							"three visible live tabs: one change stream and three transcripts",
						where: "#1181 spec, §4",
					},
				},
			],
		},
		// Seven routes each tab re-reads, eight edges a minute: two tabs sharing reads stay under it.
		{ metric: "census.sharedComputesPerMin", max: 56, unit: "/min" },
		// A thread made while the link was down shows once it is back; closing the stream's tab hands it on.
		{ metric: "census.resumeShowsMs", max: 2000, unit: "ms" },
		{ metric: "census.handoffShowsMs", max: 7000, unit: "ms" },
		{ metric: "census.poolSettingsMs", max: 5000, unit: "ms" },
		{ metric: "load.duplicateFetches", max: 1 },
		{ state: "the connection word shows, no reload, the draft kept" },
		{ state: "a score earned without the slow link doesn't count" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/conditions/slow-link-proxy.mjs up --target {url}",
		live: "{slowUrl}, the same app behind the slow link; Playwright walks add the 4x CPU with e2e/journeys/slow-link.ts",
	},
	probe: {
		run: "node scripts/fakes/conditions/slow-link-measure.mjs --ui {slowUrl} --direct {url} --thread {thread} --census 30 --runs 3 --tabs 2 --pool --stamp",
	},
	trigger: {
		run: "node scripts/fakes/conditions/slow-link-proxy.mjs drop --for 10",
		on: "schedule",
		atS: "mid",
	},
	pairsWith: ["huge.diff"],
});

export const netProviderDrop = define.condition({
	id: "net.provider-drop",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"Provider or network drop | 12, 23, 5, 17 (overloaded) | The connection word, an in-place retry, the draft kept",
		where: "#1101 bar",
	},
	appliesTo: {
		walks: ["resume-limit", "answer-ask"],
		categories: ["12", "23", "5", "17"],
	},
	simulator: "fake.failure-case",
	profile: { case: "provider-drop" },
	measure: [
		{ state: "the connection word, an in-place retry, the draft kept" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs provider-drop --url {url} --stamp net.provider-drop",
		live: "the thread the provider-drop alert opens, retried in place",
	},
});
