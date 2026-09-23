// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { operatorContract } from "@prismalens/contracts";
import type { Request } from "express";
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
	constructor(private readonly operator: OperatorResolver) {}

	@Implement(operatorContract)
	operatorRoutes() {
		return {
			whoami: implement(operatorContract.whoami).handler(
				async ({ context }) => {
					const operator = await this.operator.resolve(
						context.request as Request,
					);
					return {
						via: operator?.via ?? null,
						scopes: operator?.device.scopes ?? [],
					};
				},
			),
		};
	}
}
