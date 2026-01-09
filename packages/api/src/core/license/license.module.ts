/**
 * License Module
 *
 * NestJS module for license management and feature gating.
 */

import { Module, Global } from '@nestjs/common';
import { LicenseService } from './license.service.js';
import { LicenseController } from './license.controller.js';
import {
  LicenseGuard,
  LicenseFeatureGuard,
  LicenseTierGuard,
  LicenseWriteGuard,
} from './license.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LicenseController],
  providers: [
    LicenseService,
    LicenseGuard,
    LicenseFeatureGuard,
    LicenseTierGuard,
    LicenseWriteGuard,
  ],
  exports: [
    LicenseService,
    LicenseGuard,
    LicenseFeatureGuard,
    LicenseTierGuard,
    LicenseWriteGuard,
  ],
})
export class LicenseModule {}
