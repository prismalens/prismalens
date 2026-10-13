// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResolveDialog, reportAnswer } from "./ResolveDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const q = <T extends Element>(testId: string) =>
	document.body.querySelector(`[data-testid="${testId}"]`) as T;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

const makeIncident = (overrides: Partial<IncidentWithRelations> = {}): IncidentWithRelations =>
	({
		id: "inc-1",
		number: 42,
		title: "Test incident",
		status: "triggered",
		severity: "sev1",
		actualCause: "",
		actualCauseCategory: null,
		alerts: [],
		investigations: [],
		...overrides,
	}) as unknown as IncidentWithRelations;

describe("ResolveDialog cause length limit (#673 walk 4, QA-04)", () => {
	it("shows warning, role=alert, aria-invalid, and disables confirm when actualCause exceeds 2,000 chars", async () => {
		const longCause = "a".repeat(2001);
		const incident = makeIncident({ actualCause: longCause });

		await act(async () => {
			root.render(
				createElement(ResolveDialog, {
					open: true,
					onOpenChange: () => {},
					incident,
					onConfirm: () => {},
					mode: "edit",
				}),
			);
		});

		const count = q<HTMLParagraphElement>("resolve-cause-count");
		expect(count).not.toBeNull();
		expect(count.textContent).toBe(
			"2,001 characters. Shorten the cause to 2,000 to save it.",
		);
		expect(count.getAttribute("role")).toBe("alert");

		const textarea = q<HTMLTextAreaElement>("resolve-cause");
		expect(textarea).not.toBeNull();
		expect(textarea.getAttribute("aria-invalid")).toBe("true");

		const confirmBtn = q<HTMLButtonElement>("confirm-resolve");
		expect(confirmBtn).not.toBeNull();
		expect(confirmBtn.disabled).toBe(true);
		expect(confirmBtn.textContent).toBe("Save");
	});

	it("shows count and enables confirm when actualCause is within 2,000 chars", async () => {
		const shortCause = "1234567890";
		const incident = makeIncident({ actualCause: shortCause });

		await act(async () => {
			root.render(
				createElement(ResolveDialog, {
					open: true,
					onOpenChange: () => {},
					incident,
					onConfirm: () => {},
					mode: "edit",
				}),
			);
		});

		const count = q<HTMLParagraphElement>("resolve-cause-count");
		expect(count).not.toBeNull();
		expect(count.textContent).toBe("10 of 2,000 characters");
		expect(count.getAttribute("role")).toBeNull();

		const textarea = q<HTMLTextAreaElement>("resolve-cause");
		expect(textarea).not.toBeNull();
		expect(textarea.getAttribute("aria-invalid")).toBeNull();

		const confirmBtn = q<HTMLButtonElement>("confirm-resolve");
		expect(confirmBtn).not.toBeNull();
		expect(confirmBtn.disabled).toBe(false);
		expect(confirmBtn.textContent).toBe("Save");
	});
});

describe("reportAnswer: the standing finding (#673 w9-4)", () => {
	const run = (id: string, over: Record<string, unknown>) => ({
		id,
		kind: "investigation",
		status: "completed",
		hasReport: true,
		rootCause: null,
		rootCauseCategory: "unknown",
		...over,
	});

	it("Given a later run that named no cause, Then the dialog starts from the run that did", () => {
		const incident = makeIncident({
			investigations: [
				run("run-3", {}),
				run("run-2", {
					rootCause: "booklogr-api received `SIGTERM`",
					rootCauseCategory: "infrastructure",
				}),
				run("run-1", {}),
			],
		} as unknown as Partial<IncidentWithRelations>);
		expect(reportAnswer(incident)).toEqual({
			cause: "booklogr-api received SIGTERM",
			category: "infrastructure",
		});
	});

	it("Given the report's category is unknown, Then the category starts unset", () => {
		const incident = makeIncident({
			investigations: [run("run-2", { rootCause: "SIGTERM" })],
		} as unknown as Partial<IncidentWithRelations>);
		expect(reportAnswer(incident).category).toBe("");
	});
});
