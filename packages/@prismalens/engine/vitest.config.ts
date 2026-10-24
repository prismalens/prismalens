// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
		// Runs as its own CI job (`test:replay`); it spawns a real engine per scenario.
		exclude: [...configDefaults.exclude, "scripts/acp-replay.test.ts"],
	},
});
