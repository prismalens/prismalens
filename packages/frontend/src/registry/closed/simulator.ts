// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

interface Simulator {
	title: string;
	/** The script or fixture, relative to the repo root; the generator checks it exists. */
	path: string;
	/** The command a judge or a case runs to induce the condition. */
	run: string;
	/** `planned` forces every condition on it to `parked`. */
	status: "built" | "planned";
	/** The observed fields its stamp records. */
	stamps: readonly string[];
}

/** What induces a condition: the only thing that writes a stamp (#1101). */
export const simulators = defineClosed(
	"simulator",
	[
		"fake.failure-case",
		"fake.message-loop",
		"net.throttle",
		"seed.huge-diff",
		"unbuilt",
	] as const,
	{
		"fake.failure-case": {
			title: "A recorded provider failure played against a running PrismaLens",
			path: "scripts/fakes/failure-case.mjs",
			run: "node scripts/fakes/failure-case.mjs <case> --url <url>",
			status: "built",
			stamps: ["status", "retryAfterS"],
		},
		"fake.message-loop": {
			title: "Two scripted threads that message each other in a loop",
			path: "scripts/fakes/sessions/message-loop.json",
			run: "the fake ACP agent's message-loop session",
			status: "built",
			stamps: ["messages", "pairCapAt"],
		},
		"net.throttle": {
			title:
				"A throttling proxy for any browser or the phone, which stamps what it saw",
			path: "scripts/fakes/net-throttle.mjs",
			run: "node scripts/fakes/net-throttle.mjs --profile <condition>",
			status: "planned",
			stamps: ["rttMs", "downKbps", "upKbps", "drops"],
		},
		"seed.huge-diff": {
			title: "A seeded thread that replays feat/w2-cp against main",
			path: "scripts/fakes/huge-diff.mjs",
			run: "node scripts/fakes/huge-diff.mjs --url <url>",
			status: "planned",
			stamps: ["files", "bytesBeforeFirstFile", "longestTaskMs"],
		},
		unbuilt: {
			title: "No simulator chosen yet: a parked entry from intake",
			path: "scripts/fakes",
			run: "none yet",
			status: "planned",
			stamps: [],
		},
	} satisfies Record<string, Simulator>,
);

export type SimulatorId = (typeof simulators.members)[number];
