// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	deviceTokenFrom,
	fetchInstanceId,
	OlderBackendError,
	operatorToken,
	parsePairingToken,
	storedCandidates,
} from "./session.js";

const baseUrl = "http://127.0.0.1:4100";
const cookieName = "prismalens.device.0123456789ab";

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
				"prismalens.device=bare; Path=/",
				`${cookieName}=t%2Bk; Path=/; HttpOnly; SameSite=Lax`,
			], cookieName),
		).toBe("t+k");
		expect(deviceTokenFrom(["prismalens.device=bare"], cookieName)).toBeNull();
	});
});

describe("operatorToken", () => {
	it("keeps a stored token that still manages pairing, and pairs nothing", async () => {
		const pairOperator = vi.fn();
		const fetchImpl = vi.fn(async () =>
			response(200, { via: "device", scopes: ["admin:access"] }),
		);
		await expect(
			operatorToken({ baseUrl, cookieName, candidates: ["old"], pairOperator, fetchImpl }),
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
					response(200, {}, [`${cookieName}=fresh; Path=/; HttpOnly`]),
				);
			const token = await operatorToken({
				baseUrl,
				cookieName,
				candidates: ["old"],
				pairOperator: async () => "http://localhost:4100/pair#link",
				fetchImpl,
			});
			expect(token).toBe("fresh");
			expect(fetchImpl).toHaveBeenLastCalledWith(
				`${baseUrl}/api/pairing/redeem`,
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ token: "link", name: "Desktop app" }),
				}),
			);
		}
	});

	it("throws when pl pair printed no link or the redeem was refused", async () => {
		await expect(
			operatorToken({
				baseUrl,
				cookieName,
				candidates: [],
				pairOperator: async () => "nothing",
				fetchImpl: vi.fn(),
			}),
		).rejects.toThrow("printed no link");
		await expect(
			operatorToken({
				baseUrl,
				cookieName,
				candidates: [],
				pairOperator: async () => "/pair#link",
				fetchImpl: vi.fn(async () => response(400)),
			}),
		).rejects.toThrow("400");
	});
});

describe("identity before credential", () => {
	const id = "0123456789ab-cdef";
	it("sends the stored token only to the instance it was recorded for", () => {
		expect(
			storedCandidates({ instanceId: id, expectedId: id, stored: "s" }),
		).toEqual(["s"]);
		expect(
			storedCandidates({ instanceId: id, expectedId: "other", stored: "s" }),
		).toEqual([]);
	});

	it("sends nothing before any identity is recorded", () => {
		expect(
			storedCandidates({ instanceId: id, expectedId: null, stored: "s" }),
		).toEqual([]);
	});

	it("a mismatch re-pairs without sending the old token", async () => {
		const fetchImpl = vi.fn(async () =>
			response(200, {}, [`${cookieName}=fresh; Path=/`]),
		);
		const token = await operatorToken({
			baseUrl,
			cookieName,
			candidates: storedCandidates({
				instanceId: id,
				expectedId: "other",
				stored: "old",
			}),
			pairOperator: async () => "/pair#link",
			fetchImpl,
		});
		expect(token).toBe("fresh");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("Bearer old");
	});

	it("reads the instance id, and names a 404 as an older backend", async () => {
		await expect(
			fetchInstanceId(baseUrl, vi.fn(async () => response(200, { instanceId: id }))),
		).resolves.toBe(id);
		await expect(
			fetchInstanceId(baseUrl, vi.fn(async () => response(404))),
		).rejects.toBeInstanceOf(OlderBackendError);
	});
});
