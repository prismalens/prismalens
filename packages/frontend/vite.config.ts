import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
	server: {
		port: 3000,
		proxy: {
			// Proxy API calls to backend in development
			"/api": {
				target: `${process.env.PRISMALENS_PROTOCOL || "http"}://${process.env.PRISMALENS_HOST || "localhost"}:${process.env.PRISMALENS_PORT || "5367"}`,
				changeOrigin: true,
			},
		},
	},
	plugins: [
		// Enables Vite to resolve imports using path aliases
		tsConfigPaths(),
		tanstackStart(),
		viteReact(),
		tailwindcss()
	],
	// Environment variables
	define: {
		"process.env.NEXT_PUBLIC_DASHBOARD_URL": JSON.stringify(
			process.env.PRISMALENS_DASHBOARD_BASE_URL || "http://localhost:3000",
		),
	},
});
