// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * License Module
 *
 * NestJS module for license management and feature gating.
 * Simplified for Community/Enterprise model.
 */

import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { LicenseController } from "./license.controller.js";
import {
	LicenseFeatureGuard,
	LicenseGuard,
	LicenseTierGuard,
} from "./license.guard.js";
import { LicenseService } from "./license.service.js";

@Global()
@Module({
	imports: [ConfigModule, PrismaModule],
	controllers: [LicenseController],
	providers: [
		LicenseService,
		LicenseGuard,
		LicenseFeatureGuard,
		LicenseTierGuard,
		InternalGuard,
	],
	exports: [
		LicenseService,
		LicenseGuard,
		LicenseFeatureGuard,
		LicenseTierGuard,
	],
})
export class LicenseModule {}
