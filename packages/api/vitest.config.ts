import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

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
				branches: 60,
				functions: 60,
				lines: 60,
				statements: 60,
			},
		},
	},
});
