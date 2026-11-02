// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Webhook Raw Body Middleware
 *
 * The app boots with `bodyParser: false` so oRPC can read the request stream
 * itself. Signature verification, however, must hash the *exact bytes* the
 * sender signed — a re-serialized `JSON.parse`/`JSON.stringify` round trip
 * changes whitespace and key order and never matches.
 *
 * This middleware runs on webhook routes only. `express.json`'s `verify` hook
 * hands us the raw buffer before parsing, which we stash on `req.rawBody` for
 * the signature guards. Parsing is safe for oRPC: `toStandardBody` in
 * `@orpc/standard-server-node` short-circuits on `req.body !== undefined`, so
 * oRPC consumes the already-parsed body instead of the drained stream. Routes
 * without this middleware keep the untouched stream.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import express from "express";

/** An Express request carrying the raw bytes captured before JSON parsing. */
export type RequestWithRawBody = Request & { rawBody?: Buffer };

@Injectable()
export class WebhookRawBodyMiddleware implements NestMiddleware {
	/**
	 * Only `application/json` bodies are captured — that is what every webhook
	 * sender we verify (Render/Standard Webhooks, Prometheus, generic) posts.
	 * Any other content type falls through untouched and oRPC reads the stream.
	 */
	private readonly parseJson = express.json({
		limit: "1mb",
		// SNS posts its JSON as text/plain; only the CloudWatch route reads it that way.
		type: (req) => {
			const type = (req.headers["content-type"] ?? "").toLowerCase();
			return (
				type.startsWith("application/json") ||
				(type.startsWith("text/plain") &&
					((req as Request).originalUrl ?? req.url ?? "")
						.split("?")[0]
						.endsWith("/webhooks/cloudwatch"))
			);
		},
		verify: (req, _res, buf) => {
			(req as RequestWithRawBody).rawBody = Buffer.from(buf);
		},
	});

	use(req: Request, res: Response, next: NextFunction) {
		this.parseJson(req, res, (err?: unknown) => {
			// oRPC picks its decoder by content type; once SNS text is parsed it is JSON.
			if (!err && req.body !== undefined) {
				req.headers["content-type"] = "application/json";
			}
			next(err);
		});
	}
}
