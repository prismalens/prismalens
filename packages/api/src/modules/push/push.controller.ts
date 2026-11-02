// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { pushContract } from "@prismalens/contracts";
import type { Request } from "express";
import { operatorOnly } from "../../core/auth/pairing.controller.js";
import { PushNotFoundError, PushService } from "./push.service.js";

function deviceOf(request: Request): string {
	const id = request.operator?.device.id;
	if (!id)
		throw new ORPCError("UNAUTHORIZED", { message: "Pair this device first." });
	return id;
}

async function found<T>(work: Promise<T>): Promise<T> {
	try {
		return await work;
	} catch (error) {
		if (error instanceof PushNotFoundError)
			throw new ORPCError("NOT_FOUND", { message: error.message });
		throw error;
	}
}

/** Any paired device turns push on for itself; testing another device is the operator's. */
@Controller()
export class PushController {
	constructor(private readonly push: PushService) {}

	@Implement(pushContract)
	handlers() {
		return {
			publicKey: implement(pushContract.publicKey).handler(() => ({
				publicKey: this.push.publicKey,
			})),
			subscribe: implement(pushContract.subscribe).handler(
				({ input, context }) =>
					this.push.subscribe(deviceOf(context.request as Request), input),
			),
			unsubscribe: implement(pushContract.unsubscribe).handler(
				async ({ context }) => ({
					removed: await this.push.unsubscribe(
						deviceOf(context.request as Request),
					),
				}),
			),
			sendTest: implement(pushContract.sendTest).handler(
				({ input, context }) => {
					const request = context.request as Request;
					const self = deviceOf(request);
					const deviceId = input.deviceId ?? self;
					if (deviceId !== self) operatorOnly(request);
					return found(this.push.sendTest(deviceId));
				},
			),
			notification: implement(pushContract.notification).handler(({ input }) =>
				found(this.push.notification(input.id)),
			),
			askState: implement(pushContract.askState).handler(({ input }) =>
				found(this.push.askState(input.investigationId, input.askId)),
			),
		};
	}
}
