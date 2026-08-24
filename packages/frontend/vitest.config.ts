// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsConfigPaths()],
	test: {
		include: ["src/**/*.test.ts"],
	},
});
