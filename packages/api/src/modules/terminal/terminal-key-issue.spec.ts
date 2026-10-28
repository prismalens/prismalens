// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncomingMessage } from "node:http";
import { OPERATOR_SCOPES, DEVICE_SCOPES, terminalKeyFor } from "@prismalens/auth";
import { beforeAll, describe, expect, it } from "vitest";
import { issueTerminalKey } from "./terminal-key-issue.js";

const SECRET = "k".repeat(64);
beforeAll(() => {
	process.env.PRISMALENS_AUTH_SECRET = SECRET;
});

function req(headers: Record<string, string>, remoteAddress = "127.0.0.1"): IncomingMessage {
	return {
		headers: { host: "127.0.0.1:6473", origin: "http://127.0.0.1:6473", ...headers },
		socket: { remoteAddress, localPort: 6473 },
	} as unknown as IncomingMessage;
}

describe("issueTerminalKey (the redeem answer)", () => {
	it("gives the host's operator device its key", () => {
		expect(issueTerminalKey(req({}), { id: "d1", scopes: OPERATOR_SCOPES })).toBe(
			terminalKeyFor("d1", SECRET),
		);
	});

	it("gives nothing to a paired device's link, even redeemed on the host", () => {
		expect(issueTerminalKey(req({}), { id: "d1", scopes: DEVICE_SCOPES })).toBeUndefined();
	});

	it("gives nothing to an operator link redeemed over a tailnet or a proxy", () => {
		const tailnet = req({
			host: "box.tail1234.ts.net",
			origin: "https://box.tail1234.ts.net",
			"x-forwarded-host": "box.tail1234.ts.net",
		});
		expect(issueTerminalKey(tailnet, { id: "d1", scopes: OPERATOR_SCOPES })).toBeUndefined();
		expect(
			issueTerminalKey(req({}, "100.64.0.9"), { id: "d1", scopes: OPERATOR_SCOPES }),
		).toBeUndefined();
	});
});
