// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac, timingSafeEqual } from "node:crypto";
import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "@prismalens/config";
import type { RequestWithRawBody } from "../../middlewares/webhook-raw-body.middleware.js";
import { RENDER_WEBHOOK_PATH } from "../../shared/constants/routes.js";

/**
 * Optional HMAC signature verification guard for webhooks.
 * When PRISMALENS_WEBHOOK_SECRET is set, requires valid X-Hub-Signature-256 header.
 * When not set, all requests pass through (community edition default).
 *
 * Like the Render guard, the HMAC is computed over the raw bytes captured by
 * `WebhookRawBodyMiddleware` — re-serializing the parsed body would hash a
 * different byte sequence than the sender signed.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
	private readonly logger = new Logger(WebhookSignatureGuard.name);

	constructor(
		private readonly configService: ConfigService<EnvironmentVariables>,
	) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<RequestWithRawBody>();
		if (request.path === RENDER_WEBHOOK_PATH) {
			return true; // Render has its own dedicated signature guard
		}

		const secret = this.configService.get("PRISMALENS_WEBHOOK_SECRET");
		if (!secret) {
			return true; // No secret configured — allow all (community edition default)
		}

		const signature = request.headers["x-hub-signature-256"] as
			| string
			| undefined;

		if (!signature) {
			this.logger.warn("Webhook rejected: missing X-Hub-Signature-256 header");
			return false;
		}

		const rawBody = request.rawBody;
		if (!rawBody) {
			this.logger.warn(
				"Webhook rejected: raw request body unavailable — WebhookRawBodyMiddleware must run for this route",
			);
			return false;
		}

		const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

		try {
			const sigBuf = Buffer.from(signature);
			const expBuf = Buffer.from(expected);
			if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
				this.logger.warn("Webhook rejected: invalid signature");
				return false;
			}
		} catch {
			this.logger.warn("Webhook rejected: signature comparison failed");
			return false;
		}

		return true;
	}
}
