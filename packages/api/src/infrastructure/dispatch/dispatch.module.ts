// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Global, Module } from "@nestjs/common";
import { InvestigationsModule } from "../../modules/investigations/investigations.module.js";
import { DispatchService } from "./dispatch.service.js";
import { EventBusModule } from "./event-bus.module.js";

/**
 * Dispatch — the in-process JobStore/EventBus wiring that replaced BullMQ and Redis.
 *
 * There is no external service in this path. The job table lives in the application
 * database, the relay and the cancel channel are in-process, and the only extra process
 * is the short-lived per-run child. `pnpm dev` needs no broker to start.
 *
 * Global because `DispatchService` is reached from several feature modules.
 */
@Global()
@Module({
	imports: [EventBusModule, forwardRef(() => InvestigationsModule)],
	providers: [DispatchService],
	exports: [DispatchService],
})
export class DispatchModule {}
