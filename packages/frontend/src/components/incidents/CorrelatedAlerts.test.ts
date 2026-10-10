// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertGroup } from "@/lib/alert-groups";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AlertGroupHead } from "./CorrelatedAlerts";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/use-now", () => ({
	useNow: () => 1760000000000,
	ago: () => "5m ago",
}));

describe("AlertGroupHead", () => {
	it("renders a cleared group dot with aria-label ending ', cleared' and background var(--text-3)", () => {
		const group: AlertGroup = {
			name: "HighLatency",
			alerts: [],
			firing: 0,
			severity: "critical",
			firstAt: "2026-10-01T10:00:00Z",
			lastAt: "2026-10-01T10:05:00Z",
		};
		const html = renderToStaticMarkup(
			React.createElement(AlertGroupHead, { group }),
		);
		expect(html).toContain('aria-label="Critical, cleared"');
		expect(html).toContain("background:var(--text-3)");
	});
});
