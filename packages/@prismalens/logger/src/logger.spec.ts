// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { getCurrentWideEvent, runInRequestContext } from "./core/context.js";
import { Logger } from "./core/logger.js";
import { WideEventInterceptor } from "./integrations/nestjs/request.interceptor.js";

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
	});
});
