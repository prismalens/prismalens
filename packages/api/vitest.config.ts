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
		include: ["src/**/*.spec.ts"],
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
				"src/modules/investigations/stream-relay.service.ts":
					NEW_CODE_THRESHOLD,
				"src/core/harness/harness.service.ts": NEW_CODE_THRESHOLD,
				"src/core/harness/repo-clone.service.ts": NEW_CODE_THRESHOLD,
			},
		},
	},
});
