// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ConfigService } from "@nestjs/config";
import express from "express";
import { describe, expect, it } from "vitest";
import { deviceCookieHeader } from "./device-cookie.js";
import { InstanceIdentity } from "./instance-identity.js";

function fakeConfig(values: Record<string, string | undefined> = {}): ConfigService {
	return {
		get: (key: string) => values[key],
	} as unknown as ConfigService;
}

function send(
	port: number,
	headers: Record<string, string> = {},
): Promise<{ status: number; cookie?: string }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port, path: "/auth", method: "GET", headers },
			(res) => {
				const cookieHeader = res.headers["set-cookie"];
				const cookie = Array.isArray(cookieHeader)
					? cookieHeader[0]
					: cookieHeader;
				resolve({ status: res.statusCode ?? 0, cookie });
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("InstanceIdentity.secureFor", () => {
	it("sets Secure only for HTTPS or forwarded loopback HTTPS, or always with PRISMALENS_PUBLIC_URL https", async () => {
		let currentIdentity = new InstanceIdentity(fakeConfig());

		const app = express();
		app.get("/auth", (req, res) => {
			res.setHeader(
				"Set-Cookie",
				deviceCookieHeader("c", "t", currentIdentity.secureFor(req)),
			);
			res.json({ ok: true });
		});

		const server: Server = createServer(app);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;

		try {
			const plain = await send(port);
			expect(plain.status).toBe(200);
			expect(plain.cookie).toBeDefined();
			expect(plain.cookie).not.toContain("Secure");

			const forwarded = await send(port, { "x-forwarded-proto": "https" });
			expect(forwarded.status).toBe(200);
			expect(forwarded.cookie).toContain("Secure");

			currentIdentity = new InstanceIdentity(
				fakeConfig({ PRISMALENS_PUBLIC_URL: "https://pl.example.com" }),
			);
			const publicUrlReq = await send(port);
			expect(publicUrlReq.status).toBe(200);
			expect(publicUrlReq.cookie).toContain("Secure");
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			);
		}
	});
});
