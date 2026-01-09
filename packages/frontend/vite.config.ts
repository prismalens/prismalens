import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
    server: {
        port: 3000,
        proxy: {
            // Proxy API calls to backend in development
            '/api': {
                target: `${process.env.PRISMALENS_PROTOCOL || 'http'}://${process.env.PRISMALENS_HOST || 'localhost'}:${process.env.PRISMALENS_PORT || '5367'}`,
                changeOrigin: true,
            },
        },
    },
    plugins: [
        // Enables Vite to resolve imports using path aliases
        tsconfigPaths(),
        tanstackStart({
            srcDirectory: 'src',
            router: {
                // Use 'app' directory like Next.js App Router
                routesDirectory: 'app',
            },
        }),
        viteReact(),
    ],
    // Environment variables
    define: {
        'process.env.NEXT_PUBLIC_DASHBOARD_URL': JSON.stringify(
            process.env.PRISMALENS_DASHBOARD_BASE_URL || 'http://localhost:3000'
        ),
    },
})
