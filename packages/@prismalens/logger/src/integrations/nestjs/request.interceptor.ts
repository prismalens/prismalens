// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { catchError, finalize, tap } from "rxjs";
import { enrichContext } from "../../core/context.js";
import { Logger } from "../../core/logger.js";
import type { WideEvent } from "../../types/wide-event.js";

/**
 * Express Request type (minimal interface).
 */
interface ExpressRequest {
	method: string;
	path: string;
	route?: { path: string };
	query?: Record<string, unknown>;
	headers: Record<string, string | string[] | undefined>;
	ip?: string;
	user?: {
		id?: string;
		email?: string;
		role?: string;
	};
}

/**
 * Express Response type (minimal interface).
 */
interface ExpressResponse {
	statusCode: number;
}

/**
 * Interceptor that wraps each request in a wide event context.
 * Automatically captures request/response data and emits the event at end.
 *
 * @example
 * ```typescript
 * // In app.module.ts
 * import { APP_INTERCEPTOR } from '@nestjs/core';
 * import { WideEventInterceptor } from '@prismalens/logger/nestjs';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_INTERCEPTOR,
 *       useClass: WideEventInterceptor,
 *     },
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Injectable()
export class WideEventInterceptor implements NestInterceptor {
	private readonly logger = new Logger({ context: "WideEventInterceptor" });

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const ctx = context.switchToHttp();
		const request = ctx.getRequest<ExpressRequest>();
		const response = ctx.getResponse<ExpressResponse>();

		// Extract trace ID from headers (for distributed tracing)
		const traceId = this.getHeader(request.headers, "x-trace-id");
		const parentSpanId = this.getHeader(request.headers, "x-span-id");

		// Initial wide event context
		const initialContext: Partial<WideEvent> = {
			trace_id: traceId,
			parent_span_id: parentSpanId,
			request: {
				method: request.method,
				path: request.path,
				route: request.route?.path,
				query: request.query,
				user_agent: this.getHeader(request.headers, "user-agent"),
				ip: this.getClientIp(request),
				body_size: this.getContentLength(request.headers),
			},
		};

		// Extract user context if authenticated
		if (request.user) {
			initialContext.user = {
				id: request.user.id,
				email: request.user.email,
				role: request.user.role,
			};
		}

		// Store initial context for this request (simplified - no AsyncLocalStorage wrapper)
		// The enrichContext calls will still work for basic logging
		enrichContext(initialContext);

		// Return a proper rxjs Observable chain using pipe operators
		return next.handle().pipe(
			tap((data: unknown) => {
				// Enrich with response data on success
				enrichContext({
					response: {
						status_code: response.statusCode,
						body_size: data ? this.getBodySize(data) : 0,
					},
				});
			}),
			catchError(
				(
					error: Error & {
						status?: number;
						statusCode?: number;
						code?: string;
					},
				) => {
					// Enrich with error data on failure
					enrichContext({
						error: {
							type: error.name || "Error",
							message: error.message,
							stack: error.stack,
							code: error.code,
						},
						response: {
							status_code: error.status || error.statusCode || 500,
						},
					});
					throw error;
				},
			),
			finalize(() => {
				// Emit wide event when request completes (success or error)
				this.emitWideEvent();
			}),
		);
	}

	/**
	 * Emit the wide event at the end of request processing.
	 */
	private emitWideEvent(): void {
		this.logger.emitWideEvent();
	}

	/**
	 * Get a single header value.
	 */
	private getHeader(
		headers: Record<string, string | string[] | undefined>,
		name: string,
	): string | undefined {
		const value = headers[name.toLowerCase()];
		if (Array.isArray(value)) {
			return value[0];
		}
		return value;
	}

	/**
	 * Get the client IP address from request.
	 */
	private getClientIp(request: ExpressRequest): string | undefined {
		const forwarded = this.getHeader(request.headers, "x-forwarded-for");
		if (forwarded) {
			return forwarded.split(",")[0].trim();
		}
		return request.ip;
	}

	/**
	 * Get content length from headers.
	 */
	private getContentLength(
		headers: Record<string, string | string[] | undefined>,
	): number | undefined {
		const contentLength = this.getHeader(headers, "content-length");
		if (contentLength) {
			const parsed = parseInt(contentLength, 10);
			return isNaN(parsed) ? undefined : parsed;
		}
		return undefined;
	}

	/**
	 * Get the size of the response body.
	 */
	private getBodySize(data: unknown): number {
		if (data === null || data === undefined) {
			return 0;
		}
		if (typeof data === "string") {
			return Buffer.byteLength(data, "utf8");
		}
		if (Buffer.isBuffer(data)) {
			return data.length;
		}
		try {
			return Buffer.byteLength(JSON.stringify(data), "utf8");
		} catch {
			return 0;
		}
	}
}
