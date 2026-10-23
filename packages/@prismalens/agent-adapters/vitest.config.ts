// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

// scripts/pack.test.mjs is a node:test file run by CI's pack job, not by vitest.
export default defineConfig({
	test: { include: ["src/**/*.test.ts"] },
});
