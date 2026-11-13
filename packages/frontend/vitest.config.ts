// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsConfigPaths()],
	test: {
		// Unit tests render the registry and markdown in one pass (src/test-setup.ts).
		setupFiles: ["./src/test-setup.ts"],
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"e2e/*.test.ts",
			"*.test.ts",
		],
	},
});
