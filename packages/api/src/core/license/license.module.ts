/**
 * License Module
 *
 * NestJS module for license management and feature gating.
 * Simplified for Community/Enterprise model.
 */

import { Global, Module } from "@nestjs/common";
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
	imports: [PrismaModule],
	controllers: [LicenseController],
	providers: [
		LicenseService,
		LicenseGuard,
		LicenseFeatureGuard,
		LicenseTierGuard,
	],
	exports: [
		LicenseService,
		LicenseGuard,
		LicenseFeatureGuard,
		LicenseTierGuard,
	],
})
export class LicenseModule {}
