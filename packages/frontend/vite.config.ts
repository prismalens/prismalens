// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

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

export default defineConfig({
	server: {
		port: resolveDevPort(),
		proxy: {
			// Proxy API calls to backend in development
			"/api": {
				target: `${process.env.PRISMALENS_PROTOCOL || "http"}://${process.env.PRISMALENS_HOST || "localhost"}:${process.env.PRISMALENS_PORT || "3001"}`,
				changeOrigin: true,
			},
			// Proxy health endpoint (excluded from /api prefix in backend)
			"/health": {
				target: `${process.env.PRISMALENS_PROTOCOL || "http"}://${process.env.PRISMALENS_HOST || "localhost"}:${process.env.PRISMALENS_PORT || "3001"}`,
				changeOrigin: true,
			},
		},
	},
	plugins: [
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
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/lib/paraglide",
		}),
	],
	// Environment variables
	define: {
		"process.env.NEXT_PUBLIC_DASHBOARD_URL": JSON.stringify(
			process.env.PRISMALENS_PUBLIC_URL || "http://localhost:3000",
		),
	},
});
