// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. Order: a paired device's token, then the loopback rule. There
 * is no account (ADR 0001 §2): the host is the operator, other devices pair.
 */

import { Injectable } from "@nestjs/common";
import {
	authenticateDevice,
	type DeviceRecord,
	prismaPairingStore,
} from "@prismalens/auth";
import { resolvePlacement } from "@prismalens/config/harness";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { readDeviceToken } from "./device-cookie.js";
import { isLocalOperatorRequest } from "./local-operator.js";

export type OperatorVia = "loopback" | "device";

export interface Operator {
	via: OperatorVia;
	/** Present when `via` is `device`. */
	device?: DeviceRecord;
}

@Injectable()
export class OperatorResolver {
	constructor(private readonly prisma: PrismaService) {}

	async resolve(request: Request): Promise<Operator | null> {
		const deviceToken = readDeviceToken(request);
		if (deviceToken) {
			const device = await authenticateDevice(
				prismaPairingStore(this.prisma),
				deviceToken,
			);
			if (device) return { via: "device", device };
		}

		const local = isLocalOperatorRequest({
			remoteAddress: request.socket?.remoteAddress,
			headers: request.headers,
			placement: resolvePlacement(),
		});
		return local ? { via: "loopback" } : null;
	}
}
