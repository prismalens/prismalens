// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerStorageService } from "@nestjs/throttler";
import { describe, expect, it } from "vitest";
import { MutationThrottleGuard } from "./mutation-throttle.guard.js";

class Probe extends MutationThrottleGuard {
	skip(context: ExecutionContext) {
		return this.shouldSkip(context);
	}
	key(context: ExecutionContext) {
		return this.generateKey(context, "127.0.0.1", "short");
	}
}

function contextFor(method: string, path: string): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({ method, path }),
		}),
		getClass: () => ({ name: "SettingsController" }),
		getHandler: () => ({ name: "harnesses" }),
	} as unknown as ExecutionContext;
}

function guard() {
	return new Probe(
		{ throttlers: [{ name: "short", ttl: 1000, limit: 10 }] },
		new ThrottlerStorageService(),
		new Reflector(),
	);
}

describe("MutationThrottleGuard", () => {
	it("skips reads", async () => {
		const g = guard();
		await expect(g.skip(contextFor("GET", "/api/settings/harnesses"))).resolves.toBe(true);
		await expect(g.skip(contextFor("HEAD", "/api/setup/status"))).resolves.toBe(true);
	});

	it("limits writes", async () => {
		const g = guard();
		await expect(g.skip(contextFor("POST", "/api/setup/owner"))).resolves.toBe(false);
		await expect(g.skip(contextFor("PATCH", "/api/settings/harness"))).resolves.toBe(false);
	});

	it("keys writes by route, not by contract", () => {
		const g = guard();
		const probe = g.key(contextFor("POST", "/api/settings/harnesses/opencode/check"));
		const reset = g.key(contextFor("POST", "/api/settings/danger/reset"));
		expect(probe).not.toBe(reset);
		expect(probe).toBe(g.key(contextFor("POST", "/api/settings/harnesses/opencode/check")));
	});
});
