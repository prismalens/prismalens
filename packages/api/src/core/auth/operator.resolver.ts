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
	authenticateDeviceToken,
	type DeviceRecord,
	prismaPairingStore,
} from "@prismalens/auth";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import {
	type DeviceCredential,
	readDeviceCredential,
} from "./device-cookie.js";
import { InstanceIdentity } from "./instance-identity.js";

export type OperatorVia = "device";

export interface Operator {
	via: OperatorVia;
	device: DeviceRecord;
	/** How the token arrived; `whoami` renews a cookie credential. */
	credential: DeviceCredential;
}

export interface OperatorResolution {
	operator: Operator | null;
	reason?: "revoked";
}

@Injectable()
export class OperatorResolver {
	constructor(
		private readonly prisma: PrismaService,
		private readonly instance: InstanceIdentity,
	) {}

	async resolve(request: Request): Promise<Operator | null> {
		const { operator } = await this.resolveWithReason(request);
		return operator;
	}

	async resolveWithReason(request: Request): Promise<OperatorResolution> {
		const credential = readDeviceCredential(
			request,
			this.instance.deviceCookie,
		);
		if (!credential) return { operator: null };
		const result = await authenticateDeviceToken(
			prismaPairingStore(this.prisma),
			credential.token,
		);
		if (!result.device) {
			return { operator: null, reason: result.reason };
		}
		return {
			operator: { via: "device", device: result.device, credential },
		};
	}
}
