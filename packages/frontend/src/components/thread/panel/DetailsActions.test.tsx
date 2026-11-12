// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailsActions } from "./DetailsActions";
import type { DetailsCtx } from "./details.actions";
import "./details.actions";
import "./details.surface";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function makeCtx(overrides: Partial<DetailsCtx> = {}): DetailsCtx {
	return {
		branch: "fix/a",
		host: "github",
		pr: { number: 42, repo: "acme/repo" },
		ask: vi.fn(),
		openPr: vi.fn(),
		openFolder: vi.fn(),
		openTerminal: vi.fn(),
		facts: { is: { fixChecks: true, folder: true } },
		...overrides,
	};
}

describe("DetailsActions (#1101)", () => {
	it("renders Fix checks button with primary='fixChecks' and clicking it calls ask", async () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			ask,
			facts: { is: { fixChecks: true, folder: true } },
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<DetailsActions ctx={ctx} primary="fixChecks" />
				</TooltipProvider>,
			);
		});

		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="details-git-action"]',
		);
		expect(btn?.textContent).toBe("Fix checks");

		await act(async () => {
			btn?.click();
		});

		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith(
			"Checks fail on PR #42 (acme/repo). Find the cause, fix it on this branch and push.",
		);
	});

	it("renders no details-git-action button when primary is null", async () => {
		const ctx = makeCtx({
			facts: { is: { fixChecks: true, folder: true } },
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<DetailsActions ctx={ctx} primary={null} />
				</TooltipProvider>,
			);
		});

		expect(
			container.querySelector('[data-testid="details-git-action"]'),
		).toBeNull();
	});

	it("renders no details-open-folder button when facts.is.folder is false", async () => {
		const ctx = makeCtx({
			facts: { is: { fixChecks: true, folder: false } },
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<DetailsActions ctx={ctx} primary="fixChecks" />
				</TooltipProvider>,
			);
		});

		expect(
			container.querySelector('[data-testid="details-open-folder"]'),
		).toBeNull();
	});

	it("calls openFolder when details-open-folder button is clicked", async () => {
		const openFolder = vi.fn();
		const ctx = makeCtx({
			openFolder,
			facts: { is: { fixChecks: true, folder: true } },
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<DetailsActions ctx={ctx} primary="fixChecks" />
				</TooltipProvider>,
			);
		});

		const folderBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="details-open-folder"]',
		);
		await act(async () => {
			folderBtn?.click();
		});

		expect(openFolder).toHaveBeenCalledTimes(1);
	});
});
