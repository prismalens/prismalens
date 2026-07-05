// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { createHash, timingSafeEqual } from "crypto";

function sha256(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class InternalGuard implements CanActivate {
	constructor(private configService: ConfigService<EnvironmentVariables>) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const internalSecret = request.headers["x-internal-secret"];
		const configuredSecret = this.configService.get<string>(
			"PRISMALENS_INTERNAL_SECRET",
		);

		if (!internalSecret || !configuredSecret) {
			throw new UnauthorizedException("Invalid internal secret");
		}

		// Hash both values to normalize length before timing-safe comparison.
		// This prevents leaking the secret length via timing side-channel.
		const secretHash = sha256(configuredSecret);
		const providedHash = sha256(String(internalSecret));

		if (!timingSafeEqual(secretHash, providedHash)) {
			throw new UnauthorizedException("Invalid internal secret");
		}

		return true;
	}
}
