// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { IncidentHeader } from "./IncidentHeader";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...props
	}: {
		children: React.ReactNode;
		to?: string;
		params?: unknown;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
	useSearch: () => ({}),
}));

vi.mock("@/hooks/use-page-title", () => ({
	usePageTitle: () => {},
}));

vi.mock("@/hooks/use-escape-back", () => ({
	useEscapeBack: () => {},
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/kit/Surface", () => ({
	Surface: ({ children }: { children?: React.ReactNode }) => (
		<div>{children}</div>
	),
	SurfaceMore: () => null,
}));

vi.mock("./NoteDialog", () => ({
	NoteDialog: () => null,
}));

const makeIncident = (
	overrides: Partial<IncidentWithRelations> = {},
): IncidentWithRelations =>
	({
		id: "inc-1",
		number: 42,
		title: "API Gateway 502s",
		status: "investigating",
		severity: "sev1",
		actualCause: null,
		actualCauseCategory: null,
		alerts: [],
		investigations: [],
		tags: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	}) as unknown as IncidentWithRelations;

describe("IncidentHeader", () => {
	it("renders panel-toggle button when details prop is passed, clicking toggles panel", async () => {
		const onToggle = vi.fn();
		const incident = makeIncident();

		const { container } = await renderWithApp(
			<IncidentHeader
				incident={incident}
				view="Run 1"
				onResolve={vi.fn()}
				onReopen={vi.fn()}
				onEditCause={vi.fn()}
				details={{
					open: false,
					onToggle,
					label: "Open the panel",
					flagged: 0,
					warns: [],
				}}
			/>,
		);

		const toggleBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="panel-toggle"]',
		);
		expect(toggleBtn).not.toBeNull();
		expect(toggleBtn?.getAttribute("aria-label")).toBe("Open the panel");
		expect(toggleBtn?.getAttribute("aria-expanded")).toBe("false");

		await act(async () => {
			toggleBtn?.click();
		});

		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("renders panel-toggle button in open state when details.open is true", async () => {
		const onToggle = vi.fn();
		const incident = makeIncident();

		const { container } = await renderWithApp(
			<IncidentHeader
				incident={incident}
				view="Run 1"
				onResolve={vi.fn()}
				onReopen={vi.fn()}
				onEditCause={vi.fn()}
				details={{
					open: true,
					onToggle,
					label: "Close pane",
					flagged: 0,
					warns: [],
				}}
			/>,
		);

		const toggleBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="panel-toggle"]',
		);
		expect(toggleBtn).not.toBeNull();
		expect(toggleBtn?.getAttribute("aria-label")).toBe("Close pane");
		expect(toggleBtn?.getAttribute("aria-expanded")).toBe("true");
	});

	it("does not render panel-toggle when details prop is omitted", async () => {
		const incident = makeIncident();

		const { container } = await renderWithApp(
			<IncidentHeader
				incident={incident}
				view="Run 1"
				onResolve={vi.fn()}
				onReopen={vi.fn()}
				onEditCause={vi.fn()}
			/>,
		);

		const toggleBtn = container.querySelector('[data-testid="panel-toggle"]');
		expect(toggleBtn).toBeNull();
	});
});
