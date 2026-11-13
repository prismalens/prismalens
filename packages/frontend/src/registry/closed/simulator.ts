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
	/** What the API must load for it (scripts/fakes/conditions/api-preload.mjs); `pnpm sim` reads it. */
	api?: "standby" | "low-disk";
}

/** What induces a condition: the only thing that writes a stamp (#1101). */
export const simulators = defineClosed(
	"simulator",
	[
		"api.low-disk",
		"clock.standby",
		"fake.budget-cap",
		"fake.failure-case",
		"fake.message-loop",
		"fake.protocol-drift",
		"fake.runaway",
		"fake.settle-cleanup",
		"fake.usage-telemetry",
		"git.fixture",
		"net.throttle",
		"pw.time-zone",
		"pw.two-devices",
		"seed.huge-diff",
		"seed.huge-output",
		"unbuilt",
	] as const,
	{
		"api.low-disk": {
			title:
				"The API told its disk is nearly full: statfs reports 20 MB and git worktree add fails",
			path: "scripts/fakes/conditions/api-preload.mjs",
			run: "pnpm sim up --only git.worktree-disk (the API loads the low-disk stub)",
			status: "built",
			stamps: ["worktreeExists", "failed"],
			api: "low-disk",
		},
		"clock.standby": {
			title:
				"The API's wall clock jumps past a wake while its timers did not run, as after a laptop sleeps",
			path: "scripts/fakes/conditions/standby.mjs",
			run: "pnpm sim up --only host.standby, then its Skip button on the sheet",
			status: "built",
			stamps: ["skipMs", "clockSkipApplied", "wakeFired"],
			api: "standby",
		},
		"fake.budget-cap": {
			title:
				"A scripted agent whose spend climbs to $5, then hits the organization spend cap",
			path: "scripts/fakes/sessions/budget-cap.json",
			run: "node scripts/fakes/conditions/session-condition.mjs budget.cap --url <url>",
			status: "built",
			stamps: ["costShownUsd", "blocked"],
		},
		"fake.protocol-drift": {
			title:
				"A scripted agent a protocol version ahead, sending update kinds the host does not know",
			path: "scripts/fakes/sessions/protocol-drift.json",
			run: "node scripts/fakes/conditions/session-condition.mjs protocol.drift --url <url> --state-dir <fakes' state>",
			status: "built",
			stamps: ["hostProtocolVersion", "agentProtocolVersion", "knownTextShown"],
		},
		"fake.runaway": {
			title:
				"A scripted agent repeating the same call ten times a second until stopped",
			path: "scripts/fakes/sessions/runaway.json",
			run: "node scripts/fakes/conditions/session-condition.mjs agent.runaway --url <url>",
			status: "built",
			stamps: ["storedToolCalls", "stopMs", "cancelled"],
		},
		"fake.settle-cleanup": {
			title:
				"A thread holding a wake, a cron, a worktree and a running process, then settled",
			path: "scripts/fakes/conditions/settle-cleanup.mjs",
			run: "node scripts/fakes/conditions/settle-cleanup.mjs --url <url> --state-dir <fakes' state>",
			status: "built",
			stamps: [
				"processAliveBefore",
				"processAliveAfter",
				"cronJobsAfter",
				"cleanMs",
			],
		},
		"fake.usage-telemetry": {
			title: "A scripted agent that reports usage on every turn",
			path: "scripts/fakes/sessions/usage-telemetry.json",
			run: "node scripts/fakes/conditions/session-condition.mjs usage.telemetry --url <url>",
			status: "built",
			stamps: ["turnUsageEvents", "recordedTokens"],
		},
		"git.fixture": {
			title:
				"A project thread's worktree put into a git state: a conflict, a force-push or a deleted branch",
			path: "scripts/fakes/conditions/git-fixture.mjs",
			run: "node scripts/fakes/conditions/git-fixture.mjs <condition> --url <url>",
			status: "built",
			stamps: ["worktreeExists"],
		},
		"pw.time-zone": {
			title: "A browser in Asia/Kolkata with the en-IN locale",
			path: "packages/frontend/e2e/conditions/helpers/time-zone.ts",
			run: "pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/time-zone.ts --url <url>",
			status: "built",
			stamps: ["zoneApplied", "timesShown", "hoverNamesUtc"],
		},
		"pw.two-devices": {
			title:
				"The same running thread on a desk and a 390 px phone; the phone steers mid-turn",
			path: "packages/frontend/e2e/conditions/helpers/two-devices.ts",
			run: "pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/two-devices.ts --url <url>",
			status: "built",
			stamps: ["deskShowedMs", "phoneShows", "stillRunning"],
		},
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
			path: "scripts/fakes/conditions/slow-link-proxy.mjs",
			run: "node scripts/fakes/conditions/slow-link-proxy.mjs up --target <ui host:port> [--host 0.0.0.0]",
			status: "built",
			stamps: ["rttMs", "downKbps", "upKbps", "drops"],
		},
		"seed.huge-diff": {
			title:
				"A seeded thread that replays feat/w2-cp against main, measured on the slow link with a 4x CPU",
			path: "scripts/fakes/huge-diff.mjs",
			run: "node scripts/fakes/huge-diff.mjs --url <url> --measure",
			status: "built",
			stamps: ["files", "bytesBeforeFirstFile", "longestTaskMs"],
		},
		"seed.huge-output": {
			title:
				"Threads seeded with a huge log in a reply, a huge folded paste and a huge binary file",
			path: "packages/api/scripts/seed-huge-output.ts",
			run: "pnpm --filter @prismalens/api seed:huge-output <log|paste|binary|all>",
			status: "built",
			stamps: ["events", "eventBytes", "fileBytes"],
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
