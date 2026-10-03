// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { withoutEnabled } from "./ServiceTelemetrySection";

vi.mock("@/lib/api/hooks", () => ({}));

const row = (serviceConfig: Record<string, unknown> | null) =>
	({ serviceConfig }) as ServiceIntegrationWithStatus;

describe("ServiceTelemetrySection turning a source back on", () => {
	it("keeps the service's other override keys", () => {
		expect(withoutEnabled(row({ enabled: false, namespace: "web" }))).toEqual({
			namespace: "web",
		});
	});

	it("drops the override when only `enabled` was in it", () => {
		expect(withoutEnabled(row({ enabled: false }))).toBeNull();
		expect(withoutEnabled(row(null))).toBeNull();
	});
});
