// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The condition simulators this directory builds and the command that runs each (#1101).
// The registry's `simulator` entries point here; this list is what they are checked against.
export const SIMULATORS = {
	"net.throttle": {
		path: "scripts/fakes/conditions/slow-link-proxy.mjs",
		run: "node scripts/fakes/conditions/slow-link-proxy.mjs up --target <ui host:port> --port 3330",
		conditions: ["net.slow-link"],
	},
	"seed.huge-output": {
		path: "packages/api/scripts/seed-huge-output.ts",
		run: "pnpm --filter @prismalens/api seed:huge-output all",
		conditions: ["huge.log", "huge.paste", "huge.binary"],
	},
	"fake.session": {
		path: "scripts/fakes/conditions/session-condition.mjs",
		run: "node scripts/fakes/conditions/session-condition.mjs <condition> --url <base>",
		conditions: [
			"agent.runaway",
			"budget.cap",
			"protocol.drift",
			"usage.telemetry",
		],
	},
	"git.fixture": {
		path: "scripts/fakes/conditions/git-fixture.mjs",
		run: "node scripts/fakes/conditions/git-fixture.mjs <condition> --url <base>",
		conditions: ["git.conflict", "git.force-push", "git.branch-deleted"],
	},
	"api.low-disk": {
		path: "scripts/fakes/conditions/api-preload.mjs",
		run: "PRISMALENS_CONDITIONS=low-disk (API preload), then git-fixture.mjs git.worktree-disk",
		conditions: ["git.worktree-disk"],
	},
	"clock.standby": {
		path: "scripts/fakes/conditions/standby.mjs",
		run: "PRISMALENS_CONDITIONS=standby (API preload), then node scripts/fakes/conditions/standby.mjs --url <base>",
		conditions: ["host.standby"],
	},
	"settle.cleanup": {
		path: "scripts/fakes/conditions/settle-cleanup.mjs",
		run: "node scripts/fakes/conditions/settle-cleanup.mjs --url <base>",
		conditions: ["settle.cleanup"],
	},
	"pw.time-zone": {
		path: "packages/frontend/e2e/conditions/helpers/time-zone.ts",
		run: "pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/time-zone.ts --url <base>",
		conditions: ["time.zone"],
	},
	"pw.two-devices": {
		path: "packages/frontend/e2e/conditions/helpers/two-devices.ts",
		run: "pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/two-devices.ts --url <base>",
		conditions: ["two-devices.steer"],
	},
};
