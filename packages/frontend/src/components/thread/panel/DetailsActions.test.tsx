// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailsActions, DetailsFolder } from "./DetailsActions";
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

		// 24043161c moved the folder opener to the box's place slot.
		await act(async () => {
			root.render(
				<TooltipProvider>
					<DetailsFolder ctx={ctx} />
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
					<DetailsFolder ctx={ctx} />
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

	it("folds openers into one button and keeps one tree across fold when narrow (#1176)", async () => {
		let resizeCb: (() => void) | undefined;
		class TestResizeObserver {
			constructor(cb: () => void) {
				resizeCb = cb;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		}
		const prevRO = globalThis.ResizeObserver;
		globalThis.ResizeObserver =
			TestResizeObserver as unknown as typeof ResizeObserver;

		try {
			const ctx = makeCtx({
				openFolder: vi.fn(),
				editor: { current: "vscode", label: () => "VS Code" },
				facts: { is: { folder: true, "has.vscode": true, terminal: true } },
			});

			await act(async () => {
				root.render(
					<TooltipProvider>
						<div data-testid="details-place">
							<div>
								<span data-testid="details-place-name" />
							</div>
							<DetailsFolder ctx={ctx} />
						</div>
					</TooltipProvider>,
				);
			});

			const placeNameEl = container.querySelector(
				'[data-testid="details-place-name"]',
			);
			const nameParent = placeNameEl?.parentElement;
			expect(nameParent).not.toBeNull();
			if (!placeNameEl || !nameParent) throw new Error("no nameParent");

			// Start with slack >= need so wide is true
			Object.defineProperty(nameParent, "clientWidth", {
				value: 300,
				configurable: true,
			});
			const textWidth = (width: number) => {
				placeNameEl.getBoundingClientRect = () => ({ width }) as DOMRect;
			};
			textWidth(100);
			await act(async () => {
				resizeCb?.();
			});

			const wideFolderBtn = container.querySelector<HTMLButtonElement>(
				'[data-testid="details-open-folder"]',
			);
			expect(wideFolderBtn?.getAttribute("aria-label")).toBe("Open in VS Code");
			const wideMoreBtn = container.querySelector<HTMLButtonElement>(
				'[data-testid="details-open-with"]',
			);
			expect(wideMoreBtn?.getAttribute("aria-label")).toBe("Open with");
			expect(wideMoreBtn?.querySelector(".size-3")).not.toBeNull();

			// Move to narrow: slack < 0 so wide becomes false, folded becomes true
			Object.defineProperty(nameParent, "clientWidth", {
				value: 50,
				configurable: true,
			});
			textWidth(150);

			await act(async () => {
				resizeCb?.();
			});

			// Folded state: folder button omitted from DOM, more button becomes FolderOpen icon button naming default
			const foldedFolderBtn = container.querySelector(
				'[data-testid="details-open-folder"]',
			);
			expect(foldedFolderBtn).toBeNull();

			const foldedMoreBtn = container.querySelector<HTMLButtonElement>(
				'[data-testid="details-open-with"]',
			);
			expect(foldedMoreBtn?.getAttribute("aria-label")).toBe(
				"Open with (VS Code by default)",
			);
			expect(foldedMoreBtn?.querySelector(".size-3\\.5")).not.toBeNull();
			// The button is in the same container, maintaining a single tree across the fold
			expect(foldedMoreBtn?.parentElement?.classList.contains("relative")).toBe(
				true,
			);
		} finally {
			globalThis.ResizeObserver = prevRO;
		}
	});
});
