// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../core/auth/public.decorator.js";
import { SignIns } from "./sign-in.js";

/**
 * A server's own sign-in callback (#848, 04), for bring-your-own apps on a team server.
 * Public: the single-use state authorises it. No upstream text reaches the page.
 */
@Public()
@Controller("sources/oauth")
export class OAuthCallbackController {
	constructor(private readonly signIns: SignIns) {}

	@Get("callback")
	async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
		const params = new URL(req.originalUrl, "http://callback").searchParams;
		const outcome = await this.signIns.complete(params).catch(() => ({
			error: "exchange" as const,
		}));
		res.redirect(
			302,
			"connectionId" in outcome
				? `/settings?tab=sources&connected=${encodeURIComponent(outcome.connectionId)}`
				: `/settings?tab=sources&error=${outcome.error}`,
		);
	}
}
