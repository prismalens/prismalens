// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * Coverage floors (docs/contributing/testing.md, #1206): a ratchet, never a target.
 * A per-file entry below guards a module that already has its tests; a new module needs none.
 */
/**
 * Package floor = the coverage this package ACTUALLY had when the gate was first
 * wired into CI (#58's policy was written but never run, so the old numbers were
 * aspirational, not real). It is a RATCHET, not a target: raise it as coverage
 * improves, never lower it to make a red build pass.
 */
const PACKAGE_FLOOR = {
	statements: 46,
	branches: 41,
	functions: 39,
	lines: 45,
};

/** The host browser's seams (#1061), measured with its scenario: raise as the unit tests grow. */
const BROWSER_SEAM_THRESHOLD = {
	statements: 80,
	branches: 70,
	functions: 55,
	lines: 80,
};
const NEW_CODE_THRESHOLD = {
	statements: 80,
	branches: 80,
	functions: 80,
	lines: 80,
};

/** Branchy seams whose remaining branches a scenario walks (#1024); raise as unit cases land. */
const COMPOSER_SEAM_THRESHOLD = {
	statements: 80,
	branches: 70,
	functions: 75,
	lines: 80,
};

// The specs that need a database, a process or a socket, until they are renamed *.int.spec.ts.
const LEGACY_MEDIUM = [
	"src/core/harness/git-launch-guard.spec.ts",
	"test/journeys/in-process-target.spec.ts",
	"test/scenarios/agent-browser.spec.ts",
	"test/scenarios/alert-sources.spec.ts",
	"test/scenarios/ask-answered-end-to-end.spec.ts",
	"test/scenarios/ask-docked-question.spec.ts",
	"test/scenarios/asks-from-tools.spec.ts",
	"test/scenarios/attention.spec.ts",
	"test/scenarios/boot-catch-up.spec.ts",
	"test/scenarios/child-walk.spec.ts",
	"test/scenarios/cold-compact.spec.ts",
	"test/scenarios/composer-round-trip.spec.ts",
	"test/scenarios/cron-fire.spec.ts",
	"test/scenarios/diff-turns.spec.ts",
	"test/scenarios/evidence-at-revision.spec.ts",
	"test/scenarios/fake-acp-agent.spec.ts",
	"test/scenarios/fakes.spec.ts",
	"test/scenarios/follow-up-after-a-real-run.spec.ts",
	"test/scenarios/helper-thread-no-token.spec.ts",
	"test/scenarios/in-place-run.spec.ts",
	"test/scenarios/limit-child-reports.spec.ts",
	"test/scenarios/limit-resume.spec.ts",
	"test/scenarios/merge-incidents.spec.ts",
	"test/scenarios/pr-status-restart.spec.ts",
	"test/scenarios/provider-stops.spec.ts",
	"test/scenarios/queued-message-restart.spec.ts",
	"test/scenarios/resolved-before-firing.spec.ts",
	"test/scenarios/restart-resume.spec.ts",
	"test/scenarios/same-alert-refires.spec.ts",
	"test/scenarios/scheduled-check.spec.ts",
	"test/scenarios/services-search.spec.ts",
	"test/scenarios/subagents-app.spec.ts",
	"test/scenarios/subagents.spec.ts",
	"test/scenarios/thread-context-pr.spec.ts",
	"test/scenarios/thread-tree.spec.ts",
	"test/scenarios/tools-follow-the-thread.spec.ts",
	"test/scenarios/update-draining.spec.ts",
	"test/scenarios/vendor-alert-sources.spec.ts",
	"test/scenarios/wakeup.spec.ts",
	"test/scenarios/webhook-before-connect.spec.ts",
	"test/sqlite/service-last-report.spec.ts",
	"test/sqlite/thread-list-state.spec.ts",
	"test/sqlite/thread-window.spec.ts",
	"src/core/auth/instance-identity.spec.ts",
	"src/core/harness/git-env.spec.ts",
	"src/core/harness/git-missing.spec.ts",
	"src/core/harness/mirror-location.spec.ts",
	"src/core/harness/repo-source.service.spec.ts",
	"src/core/harness/run-worktree.spec.ts",
	"src/core/settings/diagnostics.service.spec.ts",
	"src/core/settings/update-handoff.spec.ts",
	"src/http-shutdown.spec.ts",
	"src/infrastructure/dispatch/checkout-lease.spec.ts",
	"src/infrastructure/dispatch/checkout-status.spec.ts",
	"src/infrastructure/dispatch/credential-transcript.spec.ts",
	"src/infrastructure/dispatch/dispatch.service.spec.ts",
	"src/infrastructure/dispatch/investigation-run.in-place.spec.ts",
	"src/infrastructure/dispatch/investigation-run.spec.ts",
	"src/infrastructure/dispatch/pre-run-context.spec.ts",
	"src/infrastructure/dispatch/run-comparisons.spec.ts",
	"src/infrastructure/dispatch/run-workspace-sweep.spec.ts",
	"src/middlewares/cross-site.middleware.spec.ts",
	"src/middlewares/security-headers.integration.spec.ts",
	"src/modules/changes/change-events.service.spec.ts",
	"src/modules/changes/deploy-events.service.spec.ts",
	"src/modules/changes/git-history.spec.ts",
	"src/modules/fixes/fixes.service.spec.ts",
	"src/modules/gateway/gateway.service.spec.ts",
	"src/modules/gateway/runbooks.spec.ts",
	"src/modules/impact/impact.service.spec.ts",
	"src/modules/integrations/git-credential.integration.spec.ts",
	"src/modules/integrations/integrations.service.spec.ts",
	"src/modules/integrations/source-request.spec.ts",
	"src/modules/integrations/telemetry-snapshot.service.spec.ts",
	"src/modules/investigations/attachments.thread.spec.ts",
	"src/modules/investigations/evidence-blob.spec.ts",
	"src/modules/investigations/run-views.spec.ts",
	"src/modules/investigations/service-check-runs.spec.ts",
	"src/modules/investigations/worktree-changes.spec.ts",
	"src/modules/investigations/worktree-scopes.spec.ts",
	"src/modules/investigations/worktree-snapshots.spec.ts",
	"src/modules/push/push.service.spec.ts",
	"src/modules/references/file-list.spec.ts",
	"src/modules/repositories/folder-browser.deadline.spec.ts",
	"src/modules/repositories/repo-icon-scan.spec.ts",
	"src/modules/repositories/repository-icon.service.spec.ts",
	"src/modules/repositories/start-git.spec.ts",
	"src/modules/run-workspaces/editors.spec.ts",
	"src/modules/schedules/schedules.service.spec.ts",
	"src/modules/terminal/terminal-socket.spec.ts",
	"src/modules/thread-tree/thread-tree.service.spec.ts",
	"src/modules/threads/fix-git.spec.ts",
	"src/modules/threads/pr-subscriptions/service.spec.ts",
	"src/modules/threads/pull-requests.service.spec.ts",
	"src/modules/threads/thread-context-tip.spec.ts",
	"src/modules/threads/thread-lifecycle.service.spec.ts",
	"src/modules/threads/thread-menu.service.spec.ts",
	"src/modules/threads/thread-status.service.spec.ts",
	"src/modules/usage/usage.service.spec.ts",
	"src/modules/wakes/inbox.service.spec.ts",
	"src/modules/wakes/wakes.service.spec.ts",
	// Their retries sleep on node:timers/promises until the modules read the clock (the next change).
	"src/modules/investigations/investigations-cancel.controller.spec.ts",
	"src/modules/investigations/investigations-message.controller.spec.ts",
];

// NestJS relies on `emitDecoratorMetadata` for constructor injection. Vitest's
// default esbuild transform does not emit decorator metadata, so transform the
// TypeScript with SWC (the same toolchain Nest's own build uses).
export default defineConfig({
	plugins: [
		swc.vite({
			module: { type: "es6" },
		}),
	],
	test: {
		// CI fails a test that spends over VITEST_TIMEOUT_BUDGET of its timeout here (#1085).
		...(process.env.VITEST_TIMEOUT_BUDGET
			? {
					reporters: [
						"default",
						"../../scripts/lib/timeout-budget-reporter.mjs",
					],
				}
			: {}),
		globals: true,
		environment: "node",
		root: "./",
		// Two sizes by file name (#1154): `*.spec.ts` is small, `*.int.spec.ts` medium.
		projects: [
			{
				extends: true,
				test: {
					name: "small",
					include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
					exclude: ["**/*.int.spec.ts", "**/node_modules/**", ...LEGACY_MEDIUM],
					setupFiles: ["./vitest.small.setup.ts"],
					testTimeout: 1_000,
				},
			},
			{
				extends: true,
				test: {
					name: "medium",
					include: [
						"src/**/*.int.spec.ts",
						"test/**/*.int.spec.ts",
						...LEGACY_MEDIUM,
					],
					// The listed specs carry no timeout of their own until they are renamed; the 5 s default
					// fails the ones that run git on a slow runner.
					testTimeout: 120_000,
				},
			},
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			reportsDirectory: "coverage",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.spec.ts",
				"src/**/*.interface.ts",
				"src/**/*.type.ts",
				"src/**/index.ts",
				"src/**/dto/**",
			],
			thresholds: {
				...PACKAGE_FLOOR,
				// #1101 categories 3 and 4: attention rules and presence leases
				"src/modules/attention/attention-rules.ts": NEW_CODE_THRESHOLD,
				"src/modules/attention/presence.ts": NEW_CODE_THRESHOLD,
				// #1101 categories 17-18: the Usage view and keyboard remaps
				"src/modules/usage/**": NEW_CODE_THRESHOLD,
				// #1101 categories 12-14: the thread window, find and the resumable stream
				"src/modules/investigations/thread-window/**": NEW_CODE_THRESHOLD,
				// #1024 surface F: PR status, cron and the thread lifecycle
				"src/modules/threads/pr-feed.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/settled.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/thread-lifecycle.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/cron/cron.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/cron.ts": NEW_CODE_THRESHOLD,
				// #1061: the host browser's agent tools
				"src/modules/gateway/tools/browser.ts": BROWSER_SEAM_THRESHOLD,
				// #724 and #1024 E
				"src/core/settings/update.service.ts": NEW_CODE_THRESHOLD,
				"src/core/settings/update-handoff.ts": NEW_CODE_THRESHOLD,
				"src/core/settings/diagnostics.service.ts": NEW_CODE_THRESHOLD,
				"src/core/lifecycle/admission.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/images/image-fetch.ts": NEW_CODE_THRESHOLD,
				"src/modules/images/images.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/repo-icon-scan.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/repository-icon.service.ts":
					NEW_CODE_THRESHOLD,
				"src/modules/integrations/host-repositories.service.ts":
					NEW_CODE_THRESHOLD,
				"src/modules/investigations/stream-relay.service.ts":
					NEW_CODE_THRESHOLD,
				"src/core/harness/harness.service.ts": NEW_CODE_THRESHOLD,
				"src/core/harness/repo-source.service.ts": NEW_CODE_THRESHOLD,
				"src/core/harness/git-*.ts": NEW_CODE_THRESHOLD,
				"src/modules/integrations/git-credential.service.ts":
					NEW_CODE_THRESHOLD,
				"src/modules/integrations/host-token.ts": NEW_CODE_THRESHOLD,
				"src/modules/changes/change-events.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/changes/git-history.ts": NEW_CODE_THRESHOLD,
				"src/modules/impact/*.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/impact/promql-shape.ts": NEW_CODE_THRESHOLD,
				"src/modules/impact/series-scope.ts": NEW_CODE_THRESHOLD,
				"src/modules/fixes/fixes.service.ts": NEW_CODE_THRESHOLD,
				// #1122: the code-host adapters count with the module they moved out of
				"src/modules/threads/{*,code-hosts/*}.ts": NEW_CODE_THRESHOLD,
				"src/modules/composer/drafts.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/references/ranking.ts": NEW_CODE_THRESHOLD,
				"src/modules/references/file-list.ts": NEW_CODE_THRESHOLD,
				"src/modules/references/records.provider.ts": COMPOSER_SEAM_THRESHOLD,
				"src/modules/references/references.service.ts": COMPOSER_SEAM_THRESHOLD,
				"src/modules/asks/asks.service.ts": COMPOSER_SEAM_THRESHOLD,
				"src/modules/openapi/build-spec.ts": NEW_CODE_THRESHOLD,
				"src/modules/wakes/*.ts": NEW_CODE_THRESHOLD,
				"src/modules/run-workspaces/editors.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/project-scripts.ts": NEW_CODE_THRESHOLD,
				"src/infrastructure/dispatch/checkout-lease.ts": NEW_CODE_THRESHOLD,
				"src/infrastructure/dispatch/checkout-status.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/run-scope.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/attachments.service.ts": NEW_CODE_THRESHOLD,
				"src/core/harness/ready-harness.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/worktree-changes.ts": NEW_CODE_THRESHOLD,
				// #1101 category 16: turn snapshots, diff scopes and revert
				"src/modules/investigations/worktree-snapshots.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/worktree-scopes.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/thread-titles.ts": NEW_CODE_THRESHOLD,
				"src/core/harness/thread-namer.service.ts": NEW_CODE_THRESHOLD,
				"src/shared/utils/literal-like.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/serves.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/folder-browser.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/native-folder-dialog.ts": NEW_CODE_THRESHOLD,
				"src/core/auth/host.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/start-git.ts": NEW_CODE_THRESHOLD,
				"src/infrastructure/dispatch/folder-lock.ts": NEW_CODE_THRESHOLD,
				"src/modules/schedules/allowed-asks.ts": NEW_CODE_THRESHOLD,
				"src/modules/thread-tree/*.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/thread-tree.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/propose.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/tool-asks.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/investigations/subagent-sessions.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/asks.ts": NEW_CODE_THRESHOLD,
				"src/modules/references/monitoring.provider.ts": NEW_CODE_THRESHOLD,
				"src/modules/references/work-items.provider.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/watches.ts": NEW_CODE_THRESHOLD,
			},
		},
	},
});
