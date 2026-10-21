// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ConflictException } from "@nestjs/common";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LOOPBACK_BUSY, OAuthLoopback } from "./oauth-loopback.js";
import { SignIns } from "./sign-in.js";

const PORT = 46476;
const blockers: Server[] = [];

afterEach(async () => {
	await Promise.all(blockers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("SignIns.register", () => {
	it("answers a busy loopback port as a client error carrying the port message", async () => {
		const blocker = createServer();
		blockers.push(blocker);
		await new Promise<void>((r) => blocker.listen(PORT, "127.0.0.1", r));
		const signIns = new SignIns();
		signIns.loopback = new OAuthLoopback(async () => true, { port: PORT });
		const flow = { complete: async () => ({ connectionId: "c1" }) };

		const failed = signIns.register("s1", flow, true);

		await expect(failed).rejects.toBeInstanceOf(ConflictException);
		await expect(failed).rejects.toThrow(LOOPBACK_BUSY);
	});
});
