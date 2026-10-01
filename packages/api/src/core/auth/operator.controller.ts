// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { operatorContract } from "@prismalens/contracts";
import type { Request } from "express";
import {
	clearDeviceCookieHeader,
	deviceCookieHeader,
	LEGACY_DEVICE_COOKIE,
} from "./device-cookie.js";
import { InstanceIdentity } from "./instance-identity.js";
import { OperatorResolver } from "./operator.resolver.js";
import { Public } from "./public.decorator.js";

/**
 * Public because its whole job is to answer "am I the operator?" before the
 * caller is one. It returns the reason or null and nothing else about the
 * instance.
 */
@Public()
@Controller()
export class OperatorController {
	constructor(
		private readonly operator: OperatorResolver,
		private readonly instance: InstanceIdentity,
	) {}

	@Implement(operatorContract)
	operatorRoutes() {
		return {
			whoami: implement(operatorContract.whoami).handler(
				async ({ context }) => {
					const request = context.request as Request;
					const operator = await this.operator.resolve(request);
					// Sliding expiry: a browser that keeps visiting keeps its cookie,
					// and a 0.5.0 cookie moves to this instance's name (#763).
					const via = operator?.credential.via;
					if (operator && via !== "bearer") {
						const secure = this.instance.secureCookies;
						request.res?.append(
							"Set-Cookie",
							deviceCookieHeader(
								this.instance.deviceCookie,
								operator.credential.token,
								secure,
							),
						);
						if (via === "legacy-cookie") {
							request.res?.append(
								"Set-Cookie",
								clearDeviceCookieHeader(LEGACY_DEVICE_COOKIE, secure),
							);
						}
					}
					return {
						via: operator?.via ?? null,
						scopes: operator?.device.scopes ?? [],
					};
				},
			),
		};
	}
}
