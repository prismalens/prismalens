// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SchedulesSection } from "./SchedulesSection";

const schedules = vi.hoisted(() => ({
	value: { isLoading: true, data: undefined, error: null } as {
		isLoading: boolean;
		data: unknown;
		error: null;
	},
}));
vi.mock("@/lib/api/hooks/use-schedules-orpc", () => ({
	useSchedules: () => schedules.value,
	useSetScheduleEnabled: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/thread/HelperThread", () => ({
	HelperThread: () => <div data-testid="helper-thread" />,
}));
vi.mock("@/components/schedules/schedule-templates", () => ({
	ScheduleTemplates: () => <div data-testid="schedule-templates" />,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: () => null,
	useNavigate: () => vi.fn(),
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

describe("an empty Schedules page", () => {
	const empty = (canEdit: boolean) => ({
		isLoading: false,
		error: null,
		data: { canEdit, hostName: "host", schedules: [], builtIns: [] },
	});

	it("offers the host templates and no ask-how box", () => {
		schedules.value = empty(true);
		const html = renderToStaticMarkup(<SchedulesSection />);
		expect(html).toContain('data-testid="schedule-templates"');
		expect(html).not.toContain('data-testid="helper-thread"');
	});

	it("offers the ask-how box to a device that can't save schedules", () => {
		schedules.value = empty(false);
		const html = renderToStaticMarkup(<SchedulesSection />);
		expect(html).toContain('data-testid="helper-thread"');
	});
});
