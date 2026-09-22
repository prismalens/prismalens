// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Placement } from "@prismalens/config/harness";
import express, { type Request, type Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createHostAllowlistMiddleware,
	resolveAllowedHostnames,
} from "../../middlewares/host-allowlist.middleware.js";
import { isLocalOperatorRequest } from "./local-operator.js";

interface Probe {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

let server: Server;
let port: number;
let placement: Placement = "laptop";

function probe(
	headers: Record<string, string>,
	path = "/whoami",
	method = "GET",
): Promise<Probe> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port, path, method, headers },
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

beforeAll(async () => {
	const { hostnames, disabled } = resolveAllowedHostnames({});

	const app = express();
	app.use(
		createHostAllowlistMiddleware({ allowedHostnames: hostnames, disabled }),
	);

	const handleOperator = (req: Request, res: Response) => {
		const ok = isLocalOperatorRequest({
			remoteAddress: req.socket.remoteAddress,
			headers: req.headers,
			placement,
		});
		if (ok) {
			res.status(200).json({ ok: true });
		} else {
			res.status(401).json({ error: "Unauthorized" });
		}
	};

	app.get("/whoami", handleOperator);
	app.post("/mutate", handleOperator);

	server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	);
});

beforeEach(() => {
	placement = "laptop";
});

describe("local operator rule through real server", () => {
	it("Host localhost:PORT, no extra headers -> 200 (placement laptop)", async () => {
		const res = await probe({ host: `localhost:${port}` });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true });
	});

	it("Host 127.0.0.1:PORT -> 200", async () => {
		const res = await probe({ host: `127.0.0.1:${port}` });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true });
	});

	it("Host prismalens.example -> 403 from the allowlist", async () => {
		const res = await probe({ host: "prismalens.example" });
		expect(res.status).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.message).toContain(
			'Blocked request: Host header "prismalens.example" is not allowlisted.',
		);
	});

	it("Host localhost:PORT plus X-Forwarded-For: 203.0.113.9 -> 401", async () => {
		const res = await probe({
			host: `localhost:${port}`,
			"X-Forwarded-For": "203.0.113.9",
		});
		expect(res.status).toBe(401);
	});

	it("Host localhost:PORT plus Forwarded: for=203.0.113.9 -> 401", async () => {
		const res = await probe({
			host: `localhost:${port}`,
			Forwarded: "for=203.0.113.9",
		});
		expect(res.status).toBe(401);
	});

	it("POST /mutate with Origin: https://evil.example and Host localhost:PORT -> 403", async () => {
		const res = await probe(
			{
				host: `localhost:${port}`,
				Origin: "https://evil.example",
			},
			"/mutate",
			"POST",
		);
		expect(res.status).toBe(403);
		const body = JSON.parse(res.body);
		expect(body.message).toContain(
			'Blocked request: Origin header "https://evil.example" is not allowlisted.',
		);
	});

	it("placement server, Host localhost:PORT -> 401", async () => {
		placement = "server";
		const res = await probe({ host: `localhost:${port}` });
		expect(res.status).toBe(401);
	});
});
