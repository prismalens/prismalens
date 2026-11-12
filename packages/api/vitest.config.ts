// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * Coverage gate (repo policy since #58): NEW code ships test-first with ≥80%
 * per-metric coverage, enforced per-glob. When you add a module, add it (or its
 * dir) to `thresholds` below — reviewers treat a new source file with no
 * threshold entry as a missing test. The package-wide numbers stay as the floor
 * for the pre-#58 files, which are exempt until touched.
 */
/**
 * Package floor = the coverage this package ACTUALLY had when the gate was first
 * wired into CI (#58's policy was written but never run, so the old numbers were
 * aspirational, not real). It is a RATCHET, not a target: raise it as coverage
 * improves, never lower it to make a red build pass. New code still ships at the
 * 80% per-glob threshold below.
 */
const PACKAGE_FLOOR = {
	statements: 46,
	branches: 41,
	functions: 39,
	lines: 45,
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
		globals: true,
		environment: "node",
		root: "./",
		include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			reportsDirectory: "../coverage",
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
				// #1101 categories 12-14: the thread window, find and the resumable stream
				"src/modules/investigations/thread-window/**": NEW_CODE_THRESHOLD,
				// #1024 surface F: PR status, cron and the thread lifecycle
				"src/modules/threads/pr-feed.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/pr-feed.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/settled.ts": NEW_CODE_THRESHOLD,
				"src/modules/threads/thread-lifecycle.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/cron/cron.service.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/cron.ts": NEW_CODE_THRESHOLD,
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
				"src/modules/threads/*.ts": NEW_CODE_THRESHOLD,
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
				"src/modules/threads/thread-titles.ts": NEW_CODE_THRESHOLD,
				"src/shared/utils/literal-like.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/serves.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/folder-browser.ts": NEW_CODE_THRESHOLD,
				"src/modules/repositories/start-git.ts": NEW_CODE_THRESHOLD,
				"src/infrastructure/dispatch/folder-lock.ts": NEW_CODE_THRESHOLD,
				"src/modules/schedules/allowed-asks.ts": NEW_CODE_THRESHOLD,
				"src/modules/thread-tree/*.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/thread-tree.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/propose.ts": NEW_CODE_THRESHOLD,
				"src/modules/gateway/tools/rules.ts": NEW_CODE_THRESHOLD,
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
