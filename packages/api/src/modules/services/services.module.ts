// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { ServicesController } from "./services.controller.js";
import { ServicesService } from "./services.service.js";

@Module({
	imports: [IntegrationsModule],
	controllers: [ServicesController],
	providers: [ServicesService],
	exports: [ServicesService],
})
export class ServicesModule {}
