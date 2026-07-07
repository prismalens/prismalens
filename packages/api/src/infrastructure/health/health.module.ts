// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller.js";

@Module({
	imports: [ConfigModule],
	controllers: [HealthController],
})
export class HealthModule {}
