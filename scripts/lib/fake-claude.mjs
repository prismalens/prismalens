#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A credential-free stand-in for the `claude` CLI on the SDK's stream-json control
// protocol, for scripts/lib/agent-sdk-probe.mjs (#1269). FAKE_CLAUDE=signed-out answers
// as a session with no login; anything else as a signed-in plan with two limit windows.

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const signedOut = process.env.FAKE_CLAUDE === "signed-out";

export const SIGNED_IN_ACCOUNT = {
	email: "probe@example.invalid",
	subscriptionType: "max",
};
export const SIGNED_OUT_USAGE_ERROR = "Not logged in · Please run /login";
export const RATE_LIMITS = {
	five_hour: { utilization: 12, resets_at: "2026-01-01T05:00:00.000Z" },
	seven_day: { utilization: 40, resets_at: "2026-01-07T00:00:00.000Z" },
};

function answer(request) {
	if (request.subtype === "initialize")
		return { account: signedOut ? {} : SIGNED_IN_ACCOUNT, commands: [] };
	if (request.subtype === "get_usage") {
		if (signedOut) throw new Error(SIGNED_OUT_USAGE_ERROR);
		return { rate_limits_available: true, rate_limits: RATE_LIMITS };
	}
	throw new Error(
		`fake claude: unsupported control request ${request.subtype}`,
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	for await (const line of createInterface({ input: process.stdin })) {
		const message = JSON.parse(line);
		if (message.type !== "control_request") continue;
		let response;
		try {
			response = {
				subtype: "success",
				request_id: message.request_id,
				response: answer(message.request),
			};
		} catch (error) {
			response = {
				subtype: "error",
				request_id: message.request_id,
				error: error.message,
			};
		}
		process.stdout.write(
			`${JSON.stringify({ type: "control_response", response })}\n`,
		);
	}
}
