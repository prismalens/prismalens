// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { vi } from "vitest";
import type { TelemetryService } from "../../src/core/telemetry/telemetry.service.js";

/**
 * A `TelemetryService` that records nothing and sends nothing (#602).
 *
 * Telemetry is a global module every service can reach, so a unit test that
 * constructs a service by hand needs one of these rather than a real instance
 * with a database behind it. Every method is a spy, so a test that cares which
 * event fired can assert on it.
 */
export function telemetryStub(): TelemetryService {
	return {
		capture: vi.fn(async () => undefined),
		captureFinished: vi.fn(async () => undefined),
		captureReportViewed: vi.fn(async () => undefined),
		captureFirstWebhook: vi.fn(async () => undefined),
		isEnabled: vi.fn(async () => false),
		getSettings: vi.fn(async () => ({
			enabled: false,
			decided: true,
			forcedOff: false,
			recentlySent: [],
		})),
		setEnabled: vi.fn(async () => ({
			enabled: false,
			decided: true,
			forcedOff: false,
			recentlySent: [],
		})),
		checkInstallActive: vi.fn(async () => undefined),
		onApplicationBootstrap: vi.fn(async () => undefined),
		onModuleDestroy: vi.fn(() => undefined),
	} as unknown as TelemetryService;
}
