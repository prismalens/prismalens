// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { call } from "@orpc/server";
import { deviceCookieName } from "@prismalens/auth";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { InstanceController } from "./instance.controller.js";
import type { InstanceIdentity } from "./instance-identity.js";
import { OperatorController } from "./operator.controller.js";
import { PairingRedeemController } from "./pairing.controller.js";
import type { Operator, OperatorResolver } from "./operator.resolver.js";

vi.mock("@prismalens/auth", async (original) => ({
	...(await original<typeof import("@prismalens/auth")>()),
	prismaPairingStore: () => ({}),
	redeemPairingLink: vi
		.fn()
		.mockResolvedValue({ token: "fresh", device: { id: "d2", name: "n" } }),
}));

const ID = "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const OWN = deviceCookieName(ID);
const identity = {
	instanceId: ID,
	deviceCookie: OWN,
	secureCookies: false,
} as unknown as InstanceIdentity;

function request(cookie?: string): { req: Request; setCookies: string[] } {
	const setCookies: string[] = [];
	const req = {
		headers: cookie ? { cookie } : {},
		res: {
			append: (name: string, value: string) => {
				if (name === "Set-Cookie") setCookies.push(value);
			},
		},
	} as unknown as Request;
	return { req, setCookies };
}

function whoami(operator: Operator | null) {
	const resolver = {
		resolve: vi.fn().mockResolvedValue(operator),
	} as unknown as OperatorResolver;
	const controller = new OperatorController(resolver, identity);
	return (req: Request) =>
		call(controller.operatorRoutes().whoami, {}, { context: { request: req } });
}

const device = {
	id: "d1",
	name: "Firefox on Linux",
	scopes: ["admin:access"],
} as unknown as Operator["device"];

describe("whoami renews the device cookie (#763)", () => {
	it("re-issues this instance's cookie when the credential came as one", async () => {
		const { req, setCookies } = request();
		await whoami({
			via: "device",
			device,
			credential: { token: "tok", via: "cookie" },
		})(req);
		expect(setCookies).toHaveLength(1);
		expect(setCookies[0]).toMatch(new RegExp(`^${OWN}=tok;.*Max-Age=31536000`));
	});

	it("sets no cookie for a Bearer caller or nobody", async () => {
		const bearer = request();
		await whoami({
			via: "device",
			device,
			credential: { token: "tok", via: "bearer" },
		})(bearer.req);
		expect(bearer.setCookies).toEqual([]);

		const nobody = request();
		const result = await whoami(null)(nobody.req);
		expect(nobody.setCookies).toEqual([]);
		expect(result).toEqual({ via: null, scopes: [] });
	});
});

describe("GET /api/instance (#763)", () => {
	it("is public and answers only the id, version and apiVersion", async () => {
		expect(Reflect.getMetadata(IS_PUBLIC_KEY, InstanceController)).toBe(true);
		const controller = new InstanceController(identity);
		const result = await call(controller.instanceRoutes().get, {}, { context: { request: request().req } });
		expect(Object.keys(result).sort()).toEqual([
			"apiVersion",
			"instanceId",
			"version",
		]);
		expect(result.instanceId).toBe(ID);
		expect(result.apiVersion).toBe(1);
		expect(typeof result.version).toBe("string");
	});
});

describe("redeem leaves other instances' device cookies alone (#763)", () => {
	it("sets only its own cookie; another port's cookie on the same host survives", async () => {
		const { req, setCookies } = request(
			`prismalens.device=old; prismalens.device.0123456789ab=orphan; ${OWN}=stale; theme=dark`,
		);
		const controller = new PairingRedeemController(
			{} as never,
			identity,
		);
		await call(
			controller.redeem(),
			{ token: "link" },
			{ context: { request: req } },
		);
		expect(setCookies).toHaveLength(1);
		expect(setCookies[0]).toMatch(new RegExp(`^${OWN}=fresh;`));
	});

	it("logs a one-line warn without a stack when redeeming an expired or used link", async () => {
		const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		const { req } = request();
		const { redeemPairingLink, PairingError } = await import("@prismalens/auth");
		vi.mocked(redeemPairingLink).mockRejectedValueOnce(
			new PairingError("used", "This pairing link was already used. Create a new one on the host."),
		);
		const controller = new PairingRedeemController({} as never, identity);
		await expect(
			call(controller.redeem(), { token: "used-token" }, { context: { request: req } }),
		).rejects.toThrow();

		expect(warnSpy).toHaveBeenCalledWith(
			"This pairing link was already used. Create a new one on the host.",
		);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});
});
