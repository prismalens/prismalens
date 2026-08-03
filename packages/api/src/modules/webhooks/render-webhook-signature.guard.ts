// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "@prismalens/config";
import type { Request } from "express";
import { Webhook } from "svix";

/**
 * Render Webhook Signature Guard.
 * Uses Svix standard webhooks verification scheme.
 * Checks for webhook-signature (falling back to svix-signature).
 */
@Injectable()
export class RenderWebhookSignatureGuard implements CanActivate {
	private readonly logger = new Logger(RenderWebhookSignatureGuard.name);

	constructor(
		private readonly configService: ConfigService<EnvironmentVariables>,
	) {}

	canActivate(context: ExecutionContext): boolean {
		const secret = this.configService.get("PRISMALENS_RENDER_WEBHOOK_SECRET");
		if (!secret) {
			return true; // No secret configured — allow all (community edition default)
		}

		const request = context.switchToHttp().getRequest<Request>();
		const headers = request.headers;

		const id = (headers["webhook-id"] ?? headers["svix-id"]) as
			| string
			| undefined;
		const timestamp = (headers["webhook-timestamp"] ??
			headers["svix-timestamp"]) as string | undefined;
		const signature = (headers["webhook-signature"] ??
			headers["svix-signature"]) as string | undefined;

		if (!id || !timestamp || !signature) {
			this.logger.warn(
				"Render webhook rejected: missing signature header components",
			);
			return false;
		}

		const reqWithRaw = request as Request & { rawBody?: Buffer };
		const rawBody = reqWithRaw.rawBody
			? reqWithRaw.rawBody.toString("utf8")
			: typeof request.body === "string"
				? request.body
				: JSON.stringify(request.body ?? {});

		const svixHeaders: Record<string, string> = {
			"svix-id": id,
			"svix-timestamp": timestamp,
			"svix-signature": signature,
		};

		try {
			const wh = new Webhook(secret);
			wh.verify(rawBody, svixHeaders);
			return true;
		} catch (error) {
			this.logger.warn(
				`Render webhook rejected: signature verification failed: ${error}`,
			);
			return false;
		}
	}
}
