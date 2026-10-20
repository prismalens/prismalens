// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test } from "@nestjs/testing";
import type { ProxyPort } from "@prismalens/integrations";
import { describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { GatewayService, PROXY_PORT } from "./gateway.service.js";

describe("the proxy binding (#848)", () => {
	const prisma = {
		connection: { findMany: async () => [] },
		setting: { findUnique: async () => null },
		serviceRepository: { count: async () => 0 },
		investigation: { findUnique: async () => null },
	};

	it("GatewayService takes the ProxyPort a module provides under PROXY_PORT", async () => {
		const proxy: ProxyPort = {
			snapshot: vi.fn(async () => ({ connections: [] })),
			ping: async () => ({ ok: true }),
			call: async () => ({ content: [] }),
			close: vi.fn(),
		};
		const mod = await Test.createTestingModule({
			providers: [
				GatewayService,
				{ provide: PrismaService, useValue: prisma },
				{ provide: "PROXY_PORT", useValue: proxy },
			],
		}).compile();
		const g = mod.get(GatewayService);
		(g as unknown as { baseUrl: () => string }).baseUrl = () => "http://127.0.0.1:3001";
		await g.lease("r1");
		g.revoke("r1");
		expect(PROXY_PORT).toBe("PROXY_PORT");
		expect(proxy.snapshot).toHaveBeenCalledWith("r1", 5_000);
		expect(proxy.close).toHaveBeenCalledWith("r1");
	});
});
