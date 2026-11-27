// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { QuotePopover } from "./QuotePopover";

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	document.querySelector('[data-testid="transcript"]')?.remove();
});

describe("QuotePopover (#1193 bar 6.7)", () => {
	it("shows its bar for a selection made before it mounted, as the lazy part loads after the reader selects", async () => {
		const transcript = document.createElement("div");
		transcript.dataset.testid = "transcript";
		transcript.innerHTML = '<p data-at="main:4">Retry the call three times</p>';
		document.body.appendChild(transcript);
		const range = document.createRange();
		range.selectNodeContents(transcript.querySelector("p") as HTMLElement);
		window.getSelection()?.addRange(range);

		await renderWithApp(<QuotePopover threadId="t1" onQuote={() => {}} />);

		await vi.waitFor(() =>
			expect(
				document
					.querySelector('[data-testid="quote-popover"]')
					?.getAttribute("aria-label"),
			).toBe("Selection"),
		);
	});
});
