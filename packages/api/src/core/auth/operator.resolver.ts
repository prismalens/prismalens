// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. There is no account (ADR 0001 §2) and no address grants
 * anything (ADR 0004 §8): the caller is a paired device or nobody. The host's
 * own browser is a device too, paired through the startup link `pl up` prints.
 */

import { Injectable } from "@nestjs/common";
import {
	authenticateDevice,
	type DeviceRecord,
	prismaPairingStore,
} from "@prismalens/auth";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { readDeviceToken } from "./device-cookie.js";

export type OperatorVia = "device";

export interface Operator {
	via: OperatorVia;
	device: DeviceRecord;
}

@Injectable()
export class OperatorResolver {
	constructor(private readonly prisma: PrismaService) {}

	async resolve(request: Request): Promise<Operator | null> {
		const deviceToken = readDeviceToken(request);
		if (!deviceToken) return null;
		const device = await authenticateDevice(
			prismaPairingStore(this.prisma),
			deviceToken,
		);
		return device ? { via: "device", device } : null;
	}
}
