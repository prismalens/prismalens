import { defineConfig } from "vitest/config";

// Only run source tests. tsc emits compiled *.test.js into dist/ during build;
// Vitest 4 no longer excludes those by default, so scope the run to src/.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
});
