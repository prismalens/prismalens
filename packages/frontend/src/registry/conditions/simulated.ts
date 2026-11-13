// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConditionSpec } from "../kinds/condition";

/** What a built simulator gives its condition entry; the entry wires it with one spread. */
type Simulated = Pick<
	ConditionSpec,
	"simulator" | "profile" | "stage" | "trigger"
>;

const session = (condition: string) =>
	`node scripts/fakes/conditions/session-condition.mjs ${condition} --url {url}`;
const git = (condition: string) =>
	`node scripts/fakes/conditions/git-fixture.mjs ${condition} --url {url}`;
const seed = (kind: string) =>
	`pnpm --filter @prismalens/api seed:huge-output ${kind}`;
const pw = (driver: string) =>
	`pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/${driver}.ts --url {url}`;

/**
 * The simulator, profile, stage and trigger of each condition the simulators lane built
 * (#1101). A profile is exactly what the simulator applies, so its stamp carries it unchanged.
 */
export const SIMULATED = {
	"net.slow-link": {
		simulator: "net.throttle",
		profile: {
			rttMs: 400,
			downKbps: 1600,
			upKbps: 750,
			drops: [{ atS: "mid", forS: 10 }],
		},
		stage: {
			run: "node scripts/fakes/conditions/slow-link-proxy.mjs up --url {url}",
			live: "every page through the slow-link URL on the sheet",
		},
		trigger: {
			run: "node scripts/fakes/conditions/slow-link-proxy.mjs drop --for 10",
			on: "schedule",
			atS: "mid",
		},
	},
	"huge.log": {
		simulator: "seed.huge-output",
		profile: { replyLines: 50_000, toolResults: 200, previewChars: 4000 },
		stage: { run: seed("log"), live: "the thread Huge log in a reply" },
	},
	"huge.paste": {
		simulator: "seed.huge-output",
		profile: { messageChars: 4000, pasteBytes: 3 * 1024 * 1024 },
		stage: { run: seed("paste"), live: "the thread Huge paste" },
	},
	"huge.binary": {
		simulator: "seed.huge-output",
		profile: { previewChars: 4000, fileBytes: 20 * 1024 * 1024 },
		stage: { run: seed("binary"), live: "the thread Huge binary output" },
	},
	"agent.runaway": {
		simulator: "fake.runaway",
		profile: { session: "runaway", callsPerSecond: 10, watchS: 20 },
		stage: {
			run: session("agent.runaway"),
			live: "the thread Fix the flaky retry test, stopped after 20 s",
		},
	},
	"budget.cap": {
		simulator: "fake.budget-cap",
		profile: { session: "budget-cap", costUsd: 5 },
		stage: {
			run: session("budget.cap"),
			live: "the thread Why are checkouts failing, stopped at its $5 budget",
		},
	},
	"protocol.drift": {
		simulator: "fake.protocol-drift",
		profile: { session: "protocol-drift", versionAhead: 1 },
		stage: {
			run: session("protocol.drift"),
			live: "the thread Checkout 502s from an agent a protocol version ahead",
		},
	},
	"usage.telemetry": {
		simulator: "fake.usage-telemetry",
		profile: { session: "usage-telemetry", turns: 3 },
		stage: {
			run: session("usage.telemetry"),
			live: "the thread Checkout 502s with usage on each of its three turns",
		},
	},
	"git.conflict": {
		simulator: "git.fixture",
		profile: { state: "conflict" },
		stage: {
			run: git("git.conflict"),
			live: "the project thread whose worktree has src/app.txt unmerged",
		},
	},
	"git.force-push": {
		simulator: "git.fixture",
		profile: { state: "force-push" },
		stage: {
			run: git("git.force-push"),
			live: "the project thread whose pushed branch was rewritten elsewhere",
		},
	},
	"git.branch-deleted": {
		simulator: "git.fixture",
		profile: { state: "branch-deleted" },
		stage: {
			run: git("git.branch-deleted"),
			live: "the project thread whose branch was deleted on the remote",
		},
	},
	"git.worktree-disk": {
		simulator: "api.low-disk",
		profile: { freeBytes: 20 * 1024 * 1024, worktreeAdd: "ENOSPC" },
		stage: {
			run: git("git.worktree-disk"),
			live: "the project thread whose worktree could not be made: no space left",
		},
	},
	"time.zone": {
		simulator: "pw.time-zone",
		profile: { timezoneId: "Asia/Kolkata", locale: "en-IN" },
		stage: {
			run: pw("time-zone"),
			live: "any thread in a browser set to Asia/Kolkata (time.zone.png on the sheet)",
		},
	},
	"two-devices.steer": {
		simulator: "pw.two-devices",
		profile: { deskWidth: 1600, phoneWidth: 390, steer: "mid-turn" },
		stage: {
			run: pw("two-devices"),
			live: "the thread a 390 px phone steered mid-turn (two shots on the sheet)",
		},
		trigger: { run: pw("two-devices"), on: "button" },
	},
	"host.standby": {
		simulator: "clock.standby",
		profile: { wakeDelayS: 600, skipMs: 660_000 },
		stage: {
			run: "node scripts/fakes/conditions/standby.mjs stage --url {url}",
			live: "the thread Watch the rollout, with a wake 10 minutes out",
		},
		trigger: {
			run: "node scripts/fakes/conditions/standby.mjs skip --url {url}",
			on: "button",
		},
	},
	"settle.cleanup": {
		simulator: "fake.settle-cleanup",
		profile: { holds: ["wake", "cron", "worktree", "process"] },
		stage: {
			run: "node scripts/fakes/conditions/settle-cleanup.mjs --url {url}",
			live: "the settled project thread Keep an eye on checkout",
		},
	},
} as const satisfies Record<string, Simulated>;
