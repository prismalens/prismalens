// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	type EnvironmentVariables,
	getAppDataDir,
	SecretEnvVars,
	secretFileName,
} from "@prismalens/config";
import type { RequestWithRawBody } from "../../middlewares/webhook-raw-body.middleware.js";
import {
	API_GLOBAL_PREFIX,
	RENDER_WEBHOOK_PATH,
	WEBHOOK_ROUTES,
} from "../../shared/constants/routes.js";
import {
	verifyPagerDutySignature,
	verifySentrySignature,
} from "./alert-sources/signatures.js";

/** Hashing both sides first keeps the comparison fixed-length, so timing never reveals the secret's length. */
function safeCompare(a: string, b: string): boolean {
	const digest = (s: string) => createHash("sha256").update(s).digest();
	return timingSafeEqual(digest(a), digest(b));
}

/**
 * Fronts all webhook endpoints. Accepts Bearer token, Basic auth password,
 * or X-Hub-Signature-256 HMAC against PRISMALENS_WEBHOOK_SECRET (#610).
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
	private readonly logger = new Logger(WebhookSignatureGuard.name);
	private readonly secret: string;
	private driftReported = false;

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

		if (this.vendorSignatureMatches(request)) return true;

		const authHeader = request.headers.authorization;
		const signature = request.headers["x-hub-signature-256"] as
			| string
			| undefined;
		const urlToken = this.urlTokenMatches(request);
		if (urlToken) return true;

		if (!authHeader && !signature) {
			this.logger.warn(
				"Webhook rejected: missing authorization or signature header",
			);
			throw new UnauthorizedException(
				"Missing webhook authorization or signature header",
			);
		}

		if (authHeader && this.authorizationMatches(authHeader)) {
			return true;
		}

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
		}

		this.logger.warn("Webhook rejected: no valid credential");
		this.reportSecretDrift();
		throw new ForbiddenException("Invalid webhook credentials");
	}

	/**
	 * Sentry and PagerDuty sign the body with their own secret and cannot send a
	 * Bearer token. With that secret configured, their signature is a credential
	 * on their own route only; without it they fall through to the shared secret.
	 */
	private vendorSignatureMatches(request: RequestWithRawBody): boolean {
		const rawBody = request.rawBody;
		if (!rawBody) return false;
		if (request.path === `/${API_GLOBAL_PREFIX}/${WEBHOOK_ROUTES.sentry}`) {
			const secret = this.configService.get(
				"PRISMALENS_SENTRY_WEBHOOK_SECRET",
				{
					infer: true,
				},
			);
			return (
				!!secret &&
				verifySentrySignature(
					secret,
					rawBody,
					request.headers["sentry-hook-signature"] as string | undefined,
				)
			);
		}
		if (request.path === `/${API_GLOBAL_PREFIX}/${WEBHOOK_ROUTES.pagerduty}`) {
			const secret = this.configService.get(
				"PRISMALENS_PAGERDUTY_WEBHOOK_SECRET",
				{ infer: true },
			);
			return (
				!!secret &&
				verifyPagerDutySignature(
					secret,
					rawBody,
					request.headers["x-pagerduty-signature"] as string | undefined,
				)
			);
		}
		return false;
	}

	/**
	 * Azure action groups cannot set a header, so on that route alone the shared
	 * secret may ride as `?token=`. Query strings reach access logs; rotate it if it leaks.
	 */
	private urlTokenMatches(request: RequestWithRawBody): boolean {
		if (
			request.path !== `/${API_GLOBAL_PREFIX}/${WEBHOOK_ROUTES.azureMonitor}`
		) {
			return false;
		}
		const token = request.query?.token;
		return typeof token === "string" && safeCompare(token, this.secret);
	}

	/**
	 * The secret is read once at boot. When the workspace file has since changed
	 * (rotated, restored from a backup), every sender configured with the new
	 * value is refused; say why once instead of failing silently (#605 edge 14).
	 */
	private reportSecretDrift(): void {
		if (this.driftReported) return;
		let onDisk: string;
		try {
			onDisk = readFileSync(
				join(getAppDataDir(), secretFileName(SecretEnvVars.WEBHOOK_SECRET)),
				"utf-8",
			).trim();
		} catch {
			return;
		}
		if (!onDisk || safeCompare(onDisk, this.secret)) return;
		this.driftReported = true;
		this.logger.error(
			"The webhook secret file changed after this process started; webhooks are still checked against the old value. Restart `pl up` to use the new one.",
		);
	}

	/** Bearer token, or Basic auth with the secret as password (any username). */
	private authorizationMatches(authHeader: string): boolean {
		const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
		if (bearer) {
			return safeCompare(bearer[1].trim(), this.secret);
		}
		const basic = authHeader.match(/^Basic\s+(.+)$/i);
		if (basic) {
			const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
			const colonIdx = decoded.indexOf(":");
			const password = colonIdx === -1 ? decoded : decoded.slice(colonIdx + 1);
			return safeCompare(password, this.secret);
		}
		return false;
	}
}
