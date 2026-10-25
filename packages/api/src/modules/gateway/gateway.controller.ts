// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Readable } from "node:stream";
import { All, Controller, Param, Req, Res } from "@nestjs/common";
import type {
	Request as ExpressRequest,
	Response as ExpressResponse,
} from "express";
import { Public } from "../../core/auth/public.decorator.js";
import { GATEWAY_ROUTE, GatewayService } from "./gateway.service.js";

/**
 * The gateway's HTTP face. Public to the session guard on purpose: a device or
 * session token never opens it, only the run's own bearer, checked in `serve`.
 */
@Public()
@Controller()
export class GatewayController {
	constructor(private readonly gateway: GatewayService) {}

	@All(GATEWAY_ROUTE)
	async handle(
		@Param("runId") runId: string,
		@Req() req: ExpressRequest,
		@Res() res: ExpressResponse,
	): Promise<void> {
		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers))
			if (typeof value === "string") headers.set(name, value);
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const request = new Request(`http://gateway${req.originalUrl}`, {
			method: req.method,
			headers,
			...(hasBody
				? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }
				: {}),
		} as RequestInit);
		const response = await this.gateway.serve(runId, request);
		res.status(response.status);
		response.headers.forEach((value, name) => {
			res.setHeader(name, value);
		});
		if (!response.body) {
			res.end();
			return;
		}
		Readable.fromWeb(response.body as never).pipe(res);
	}
}
