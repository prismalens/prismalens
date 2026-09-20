// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ExecutionContext,
	ForbiddenException,
	Logger,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";

const BOOT_SECRET = "secret-at-boot";
const SECRET_FILE = "PRISMALENS_WEBHOOK_SECRET_FILE";

const guardWith = (secret: string) =>
	new WebhookSignatureGuard({
		get: () => secret,
	} as unknown as ConfigService);

const bearer = (token: string): ExecutionContext =>
	({
		switchToHttp: () => ({
			getRequest: () => ({
				headers: { authorization: `Bearer ${token}` },
				path: "/webhooks/prometheus",
			}),
		}),
	}) as unknown as ExecutionContext;

describe("WebhookSignatureGuard secret drift (#605 edge 14)", () => {
	let workspace: string;
	let error: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "pl-webhook-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", workspace);
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		rmSync(workspace, { recursive: true, force: true });
	});

	it("accepts the boot secret", () => {
		expect(guardWith(BOOT_SECRET).canActivate(bearer(BOOT_SECRET))).toBe(true);
	});

	it("names the changed secret file once when a sender is refused after a rotation", () => {
		writeFileSync(join(workspace, SECRET_FILE), "rotated-secret\n");
		const guard = guardWith(BOOT_SECRET);

		expect(() => guard.canActivate(bearer("rotated-secret"))).toThrow(
			ForbiddenException,
		);
		expect(() => guard.canActivate(bearer("rotated-secret"))).toThrow(
			ForbiddenException,
		);
		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0][0])).toContain("Restart `pl up`");
	});

	it("says nothing extra when the file still matches", () => {
		writeFileSync(join(workspace, SECRET_FILE), BOOT_SECRET);
		expect(() => guardWith(BOOT_SECRET).canActivate(bearer("wrong"))).toThrow(
			ForbiddenException,
		);
		expect(error).not.toHaveBeenCalled();
	});
});
