// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ProxyOptions } from "vite";

/**
 * Vite's proxy pipes the API's response into the browser's, and a pipe does not
 * pass on an abort: with the API killed, the change stream stayed open and the
 * reconnect line never showed. Dropping the browser's side is what the API would do.
 */
export function apiProxy(target: string): ProxyOptions {
	return {
		target,
		changeOrigin: true,
		configure: (proxy) => {
			proxy.on("proxyRes", (proxyRes, _req, res) => {
				proxyRes.on("close", () => {
					if (!proxyRes.complete) res.destroy();
				});
			});
		},
	};
}
