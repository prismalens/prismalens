// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { firstPaintChunks } from "./chunk-plan.ts";
import { devPair } from "./dev-pair.ts";
import { apiProxy } from "./dev-proxy.ts";
import { firstPaintReport } from "./first-paint-report.ts";
import { thirdPartyNotices } from "./third-party-notices.ts";

/**
 * Overridable so an e2e run (or a second worktree) can take a free port instead
 * of fighting the dev stack for 3000. Default is unchanged.
 *
 * Validated rather than coerced: `Number("")` and `Number("nope")` would hand
 * Vite `0`/`NaN`, and it would then bind a RANDOM port and carry on. Every
 * later failure would point at the wrong thing.
 */
function resolveDevPort(): number {
	const raw = process.env.PRISMALENS_FRONTEND_PORT;
	if (raw === undefined || raw === "") return 3000;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`PRISMALENS_FRONTEND_PORT must be an integer between 1 and 65535, got "${raw}"`,
		);
	}
	return port;
}

const API_ORIGIN = `${process.env.PRISMALENS_PROTOCOL || "http"}://${process.env.PRISMALENS_HOST || "localhost"}:${process.env.PRISMALENS_PORT || "3001"}`;

export default defineConfig({
	// e2e runs one Vite per worker, each with its own cache (playwright.config.ts).
	cacheDir: process.env.PRISMALENS_VITE_CACHE_DIR,
	environments: {
		client: {
			build: {
				rolldownOptions: {
					output: {
						// React in its own chunk: it changes least, so a returning browser keeps it cached
						// across upgrades. The rest of a first paint is a shell and a page (chunk-plan.ts).
						codeSplitting: {
							groups: [
								{
									name: "react",
									priority: 4,
									test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/,
								},
								...firstPaintChunks([
									// The signed-in layout renders on every page.
									{
										name: "shell",
										root: /[\\/]routes[\\/]_authenticated\.tsx\?tsr-split=component$/,
									},
									{
										name: "home",
										root: /[\\/]_authenticated[\\/]new\.tsx\?tsr-split=component$/,
									},
									{
										name: "thread",
										root: /[\\/]threads[\\/]\$id\.tsx\?tsr-split=component$/,
									},
								]),
							],
						},
					},
				},
			},
		},
	},
	server: {
		port: resolveDevPort(),
		proxy: {
			// Proxy API calls to backend in development (and `vite preview`, which inherits this)
			"/api": apiProxy(API_ORIGIN),
			// Proxy health endpoint (excluded from /api prefix in backend)
			"/health": apiProxy(API_ORIGIN),
		},
	},
	plugins: [
		devPair({ apiOrigin: API_ORIGIN }),
		// Enables Vite to resolve imports using path aliases
		tsConfigPaths(),
		// SPA mode is what makes `pl up` possible (issue #237). Without it
		// TanStack Start emits SSR output — a server bundle and NO index.html —
		// and the single-process shape has no frontend server to run that bundle.
		// `prerender.outputPath` overrides the default `/_shell`: the artifact's
		// SPA entry has to be `index.html`, because that is the only name
		// express.static serves for a directory request.
		tanstackStart({
			spa: { enabled: true, prerender: { outputPath: "/index.html" } },
		}),
		viteReact(),
		tailwindcss(),
		firstPaintReport(
			fileURLToPath(new URL("./dist/first-paint.json", import.meta.url)),
		),
		thirdPartyNotices({ generated: ["tailwindcss", "tailwindcss-animate"] }),
	],
	// Environment variables
	define: {
		"process.env.NEXT_PUBLIC_DASHBOARD_URL": JSON.stringify(
			process.env.PRISMALENS_PUBLIC_URL || "http://localhost:3000",
		),
	},
});
