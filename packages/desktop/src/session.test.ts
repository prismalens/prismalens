// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { deviceTokenFrom, operatorToken, parsePairingToken } from "./session.js";

const baseUrl = "http://127.0.0.1:4100";

function response(
	status: number,
	body: unknown = {},
	setCookie: string[] = [],
): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		headers: { getSetCookie: () => setCookie },
	} as unknown as Response;
}

describe("parsePairingToken / deviceTokenFrom", () => {
	it("reads the token from pl pair's output, colour codes and all", () => {
		const out =
			"\n  http://localhost:4100/pair#AbC_-123\n\n\u001b[36mℹ\u001b[39m Open it in this machine's browser";
		expect(parsePairingToken(out)).toBe("AbC_-123");
		expect(parsePairingToken("no link here")).toBeNull();
	});

	it("reads the device token from Set-Cookie, and only that cookie", () => {
		expect(
			deviceTokenFrom([
				"other=1; Path=/",
				"prismalens.device=t%2Bk; Path=/; HttpOnly; SameSite=Lax",
			]),
		).toBe("t+k");
		expect(deviceTokenFrom(["other=1"])).toBeNull();
	});
});

describe("operatorToken", () => {
	it("keeps a stored token that still manages pairing, and pairs nothing", async () => {
		const pairOperator = vi.fn();
		const fetchImpl = vi.fn(async () =>
			response(200, { via: "device", scopes: ["admin:access"] }),
		);
		await expect(
			operatorToken({ baseUrl, storedToken: "old", pairOperator, fetchImpl }),
		).resolves.toBe("old");
		expect(pairOperator).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledWith(`${baseUrl}/api/operator/whoami`, {
			headers: { authorization: "Bearer old" },
		});
	});

	it("pairs afresh when the stored token was revoked or lacks the access scope", async () => {
		for (const whoami of [
			response(401),
			response(200, { via: "device", scopes: ["investigate:read"] }),
		]) {
			const fetchImpl = vi
				.fn()
				.mockResolvedValueOnce(whoami)
				.mockResolvedValueOnce(
					response(200, {}, ["prismalens.device=fresh; Path=/; HttpOnly"]),
				);
			const token = await operatorToken({
				baseUrl,
				storedToken: "old",
				pairOperator: async () => "http://localhost:4100/pair#link",
				fetchImpl,
			});
			expect(token).toBe("fresh");
			expect(fetchImpl).toHaveBeenLastCalledWith(
				`${baseUrl}/api/pairing/redeem`,
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ token: "link" }),
				}),
			);
		}
	});

	it("throws when pl pair printed no link or the redeem was refused", async () => {
		await expect(
			operatorToken({
				baseUrl,
				storedToken: null,
				pairOperator: async () => "nothing",
				fetchImpl: vi.fn(),
			}),
		).rejects.toThrow("printed no link");
		await expect(
			operatorToken({
				baseUrl,
				storedToken: null,
				pairOperator: async () => "/pair#link",
				fetchImpl: vi.fn(async () => response(400)),
			}),
		).rejects.toThrow("400");
	});
});
