// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { getCurrentWideEvent, runInRequestContext } from "./core/context.js";
import { Logger } from "./core/logger.js";
import { WideEventInterceptor } from "./integrations/nestjs/request.interceptor.js";
import { redactSensitiveData } from "./utils/redaction.js";

describe("Logger & WideEventInterceptor (#249)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Concurrent HTTP request context isolation", () => {
		it("should isolate wide event context across concurrent requests using AsyncLocalStorage", async () => {
			const interceptor = new WideEventInterceptor();

			const eventsEmitted: Record<string, unknown>[] = [];
			vi.spyOn(Logger.prototype, "emitWideEvent").mockImplementation(function (
				this: Logger,
			) {
				const evt = getCurrentWideEvent();
				if (evt) eventsEmitted.push(evt);
			});

			const createMockContext = (path: string, userAgent: string) =>
				({
					switchToHttp: () => ({
						getRequest: () => ({
							method: "GET",
							path,
							headers: { "user-agent": userAgent },
						}),
						getResponse: () => ({
							statusCode: 200,
						}),
					}),
				}) as unknown as ExecutionContext;

			const mockHandler: CallHandler = {
				handle: () => of({ ok: true }),
			};

			// Simulate Request A and Request B running concurrently
			const promiseA = new Promise<void>((resolve) => {
				const ctxA = createMockContext("/route-A", "Agent-A");
				const obsA = interceptor.intercept(ctxA, mockHandler);
				obsA.subscribe({
					complete: () => resolve(),
				});
			});

			const promiseB = new Promise<void>((resolve) => {
				const ctxB = createMockContext("/route-B", "Agent-B");
				const obsB = interceptor.intercept(ctxB, mockHandler);
				obsB.subscribe({
					complete: () => resolve(),
				});
			});

			await Promise.all([promiseA, promiseB]);

			expect(eventsEmitted.length).toBe(2);
			const pathA = (eventsEmitted[0] as any)?.request?.path;
			const pathB = (eventsEmitted[1] as any)?.request?.path;

			expect([pathA, pathB]).toContain("/route-A");
			expect([pathA, pathB]).toContain("/route-B");
			expect(pathA).not.toEqual(pathB);
		});
	});

	describe("Per-call log redaction", () => {
		it("should redact secret-shaped fields in per-call log lines before passing to pino", () => {
			const logger = new Logger({ context: "TestService" });

			let passedLogObj: Record<string, unknown> | null = null;

			// Spy on internal pino logger
			vi.spyOn((logger as any).pino, "info").mockImplementation(
				(obj: unknown) => {
					passedLogObj = obj as Record<string, unknown>;
				},
			);

			logger.info("User created", {
				userId: "u-123",
				password: "SuperSecretPassword123!",
				apiKey: "pk_live_abcdef123456",
			});

			expect(passedLogObj).not.toBeNull();
			expect(passedLogObj!["password"]).toBe("[REDACTED]");
			expect(passedLogObj!["apiKey"]).toBe("[REDACTED]");
			expect(passedLogObj!["userId"]).toBe("u-123");
		});

		it("should redact camelCase secret keys that the sensitive-key set only listed in mixed case", () => {
			const logger = new Logger({ context: "TestService" });

			let passedLogObj: Record<string, unknown> | null = null;
			vi.spyOn((logger as any).pino, "info").mockImplementation(
				(obj: unknown) => {
					passedLogObj = obj as Record<string, unknown>;
				},
			);

			logger.info("Credentials issued", {
				accessToken: "at_live_abcdef",
				refreshToken: "rt_live_abcdef",
				privateKey: "-----BEGIN PRIVATE KEY-----",
				creditCard: "4111111111111111",
				userId: "u-123",
			});

			expect(passedLogObj).not.toBeNull();
			expect(passedLogObj!["accessToken"]).toBe("[REDACTED]");
			expect(passedLogObj!["refreshToken"]).toBe("[REDACTED]");
			expect(passedLogObj!["privateKey"]).toBe("[REDACTED]");
			expect(passedLogObj!["creditCard"]).toBe("[REDACTED]");
			expect(passedLogObj!["userId"]).toBe("u-123");
		});
	});

	describe("redactSensitiveData structural handling", () => {
		it("should redact secret keys whatever casing they were logged with", () => {
			const redacted = redactSensitiveData({
				ACCESS_TOKEN: "a",
				Password: "b",
				CVV: "c",
				requestId: "r-1",
			});

			expect(redacted.ACCESS_TOKEN).toBe("[REDACTED]");
			expect(redacted.Password).toBe("[REDACTED]");
			expect(redacted.CVV).toBe("[REDACTED]");
			expect(redacted.requestId).toBe("r-1");
		});

		it("should redact inside arrays without turning nested arrays into objects", () => {
			const redacted = redactSensitiveData({
				users: [{ id: "1", password: "hunter2" }],
				matrix: [
					[1, 2],
					[3, 4],
				],
			});

			expect(Array.isArray(redacted.users)).toBe(true);
			expect((redacted.users as Array<Record<string, unknown>>)[0].password).toBe(
				"[REDACTED]",
			);
			expect((redacted.users as Array<Record<string, unknown>>)[0].id).toBe("1");
			expect(redacted.matrix).toEqual([
				[1, 2],
				[3, 4],
			]);
		});

		it("should pass Date, Error and Buffer values through instead of flattening them", () => {
			const when = new Date("2026-01-01T00:00:00.000Z");
			const err = new Error("boom");
			const buf = Buffer.from("hello");

			const redacted = redactSensitiveData({ when, err, buf });

			expect(redacted.when).toBeInstanceOf(Date);
			expect((redacted.when as Date).toISOString()).toBe(
				"2026-01-01T00:00:00.000Z",
			);
			expect(redacted.err).toBeInstanceOf(Error);
			expect((redacted.err as Error).message).toBe("boom");
			expect(Buffer.isBuffer(redacted.buf)).toBe(true);
			expect((redacted.buf as Buffer).toString()).toBe("hello");
		});

		it("should survive a self-referential object instead of crashing the logger", () => {
			const cyclic: Record<string, unknown> = {
				id: "1",
				password: "hunter2",
			};
			cyclic.self = cyclic;
			cyclic.children = [cyclic];

			const redacted = redactSensitiveData(cyclic);

			expect(redacted.id).toBe("1");
			expect(redacted.password).toBe("[REDACTED]");
			expect(redacted.self).toBe("[CIRCULAR]");
			expect((redacted.children as unknown[])[0]).toBe("[CIRCULAR]");
		});
	});
});
