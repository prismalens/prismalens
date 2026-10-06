// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { apiProxy } from "./dev-proxy.ts";

const port = (s: Server) => (s.address() as AddressInfo).port;
let api: Server | undefined;
let vite: ViteDevServer | undefined;

afterEach(async () => {
	await vite?.close();
	api?.closeAllConnections();
	api?.close();
});

/** An API whose change stream stays open until the process dies. */
async function streamingApi(): Promise<Server> {
	const server = createHttpServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write(": open\n\n");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return server;
}

async function viteProxying(target: string): Promise<ViteDevServer> {
	const server = await createServer({
		configFile: false,
		logLevel: "silent",
		server: { port: 0, host: "127.0.0.1", proxy: { "/api": apiProxy(target) } },
	});
	await server.listen();
	return server;
}

describe("apiProxy", () => {
	it("ends the browser's stream when the API dies mid-stream", async () => {
		api = await streamingApi();
		vite = await viteProxying(`http://127.0.0.1:${port(api)}`);
		const res = await fetch(
			`http://127.0.0.1:${port(vite.httpServer as Server)}/api/live/changes`,
		);
		const reader = res.body?.getReader();
		expect((await reader?.read())?.done).toBe(false);

		api.closeAllConnections();
		const ended = reader?.read().then(
			(r) => (r.done ? "ended" : "data"),
			() => "ended",
		);
		const outcome = await Promise.race([
			ended,
			new Promise((r) => setTimeout(() => r("still open"), 3_000)),
		]);
		expect(outcome).toBe("ended");
	});
});
