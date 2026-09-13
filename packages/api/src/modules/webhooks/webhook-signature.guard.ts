// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac, timingSafeEqual } from "node:crypto";
import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "@prismalens/config";
import type { RequestWithRawBody } from "../../middlewares/webhook-raw-body.middleware.js";
import { RENDER_WEBHOOK_PATH } from "../../shared/constants/routes.js";

function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Fronts all webhook endpoints. Accepts Bearer token, Basic auth password,
 * or X-Hub-Signature-256 HMAC against PRISMALENS_WEBHOOK_SECRET (#610).
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
	private readonly logger = new Logger(WebhookSignatureGuard.name);
	private readonly secret: string;

	constructor(
		private readonly configService: ConfigService<EnvironmentVariables>,
	) {
		const secret = this.configService.get("PRISMALENS_WEBHOOK_SECRET", {
			infer: true,
		});
		if (!secret) {
			throw new Error("PRISMALENS_WEBHOOK_SECRET is required");
		}
		this.secret = secret;
	}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<RequestWithRawBody>();
		if (request.path === RENDER_WEBHOOK_PATH) {
			return true; // Render has its own dedicated signature guard
		}

		const authHeader = request.headers.authorization;
		if (authHeader) {
			const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
			if (bearerMatch) {
				const token = bearerMatch[1].trim();
				if (safeCompare(token, this.secret)) {
					return true;
				}
				this.logger.warn("Webhook rejected: invalid bearer token");
				throw new ForbiddenException("Invalid authorization token");
			}

			const basicMatch = authHeader.match(/^Basic\s+(.+)$/i);
			if (basicMatch) {
				const decoded = Buffer.from(basicMatch[1].trim(), "base64").toString(
					"utf8",
				);
				const colonIdx = decoded.indexOf(":");
				const password =
					colonIdx === -1 ? decoded : decoded.slice(colonIdx + 1);
				if (safeCompare(password, this.secret)) {
					return true;
				}
				this.logger.warn("Webhook rejected: invalid basic auth credentials");
				throw new ForbiddenException("Invalid basic auth credentials");
			}

			this.logger.warn("Webhook rejected: unsupported authorization scheme");
			throw new ForbiddenException("Unsupported authorization scheme");
		}

		const signature = request.headers["x-hub-signature-256"] as
			| string
			| undefined;

		if (signature) {
			const rawBody = request.rawBody;
			if (!rawBody) {
				this.logger.warn(
					"Webhook rejected: raw request body unavailable — WebhookRawBodyMiddleware must run for this route",
				);
				throw new ForbiddenException("Raw request body unavailable");
			}

			const expected = `sha256=${createHmac("sha256", this.secret).update(rawBody).digest("hex")}`;
			if (safeCompare(signature, expected)) {
				return true;
			}
			this.logger.warn("Webhook rejected: invalid signature");
			throw new ForbiddenException("Invalid webhook signature");
		}

		this.logger.warn(
			"Webhook rejected: missing authorization or signature header",
		);
		throw new UnauthorizedException(
			"Missing webhook authorization or signature header",
		);
	}
}
