// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
});
