// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { EVENT_BUS, InProcessEventBus } from "./event-bus.js";

/**
 * The process-wide EventBus.
 *
 * Registered on its own, ahead of everything that uses it, so that the relay (which
 * consumes it) and the dispatch loop (which publishes to it) do not have to be
 * circularly related to each other just to share a bus.
 */
@Global()
@Module({
	providers: [{ provide: EVENT_BUS, useClass: InProcessEventBus }],
	exports: [EVENT_BUS],
})
export class EventBusModule {}
