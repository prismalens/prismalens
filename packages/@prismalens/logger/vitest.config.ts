// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		swc.vite({
			jsc: {
				parser: { syntax: "typescript", decorators: true },
				transform: { legacyDecorator: true, decoratorMetadata: true },
			},
		}),
	],
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.spec.ts"],
	},
});
