// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { OverlayService } from "./overlay.service.js";

/**
 * Overlay module — the app-side reduce overlay (ADR-0016 §5c). Exposes
 * {@link OverlayService} so the investigations writer path can enrich a report
 * after it lands. PrismaService is provided globally (core), so no imports here.
 */
@Module({
	providers: [OverlayService],
	exports: [OverlayService],
})
export class OverlayModule {}
