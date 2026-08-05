// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/main.ts"],
	format: ["esm"],
	target: "node22",
	platform: "node",
	clean: false,
	dts: false,
	sourcemap: false,
	noExternal: [/^@prismalens\//],
});
