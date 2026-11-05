// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SchedulesSection } from "./SchedulesSection";

vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useSchedules: () => ({ isLoading: true, data: undefined, error: null }),
	useSetScheduleEnabled: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/thread/HelperThread", () => ({
	HelperThread: () => null,
}));
vi.mock("@/components/schedules/ScheduleDialog", () => ({
	ScheduleDialog: () => null,
}));

describe("SchedulesSection layout (review of #1031)", () => {
	it("is its own container, so the @3xl table layout can apply", () => {
		const html = renderToStaticMarkup(<SchedulesSection />);
		const root = /^<div class="([^"]*)"/.exec(html)?.[1] ?? "";
		expect(root.split(" ")).toContain("@container");
		expect(root).not.toContain("max-w-(--reading-w)");
	});
});
