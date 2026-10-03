// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { connect } from "node:net";
import { Controller, Get, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import type { Response } from "express";
import { describe, expect, it } from "vitest";

@Controller()
class HeldStreamController {
	@Get("stream")
	stream(@Res() res: Response): void {
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.flushHeaders();
	}
}

@Module({ controllers: [HeldStreamController] })
class HeldStreamModule {}

async function closeWithOpenStream(forceCloseConnections: boolean) {
	const app = await NestFactory.create(HeldStreamModule, {
		logger: false,
		forceCloseConnections,
	});
	await app.listen(0, "127.0.0.1");
	const { port } = app.getHttpServer().address() as { port: number };
	const socket = connect(port, "127.0.0.1");
	await new Promise<void>((resolve) => {
		socket.write("GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n");
		socket.once("data", () => resolve());
	});
	const closed = app.close().then(() => "closed" as const);
	const timedOut = new Promise<"hung">((resolve) =>
		setTimeout(() => resolve("hung"), 2_000).unref(),
	);
	const outcome = await Promise.race([closed, timedOut]);
	socket.destroy();
	await closed;
	return outcome;
}

describe("shutdown with a browser holding an event stream open (walk f20)", () => {
	it("hangs without forceCloseConnections — the bug", async () => {
		expect(await closeWithOpenStream(false)).toBe("hung");
	});

	it("closes promptly with forceCloseConnections, as main.ts sets it", async () => {
		expect(await closeWithOpenStream(true)).toBe("closed");
	});
});
