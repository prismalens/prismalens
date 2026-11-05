// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShortcutSheet } from "@/components/shared/ShortcutSheet";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";
import { PLACES } from "./places";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/ui/dialog", () => {
	const Pass = ({ children }: { children?: React.ReactNode }) => (
		<>{children}</>
	);
	return {
		Dialog: Pass,
		DialogContent: Pass,
		DialogDescription: Pass,
		DialogHeader: Pass,
		DialogTitle: Pass,
	};
});

describe("one places list (#1020)", () => {
	it("gives every g key from the places, and nothing else", () => {
		expect(GO_SHORTCUTS).toEqual(
			PLACES.filter((p) => p.goKey).map((p) => ({
				key: p.goKey,
				to: p.to,
				label: p.label,
			})),
		);
		const keys = GO_SHORTCUTS.map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("puts a Go to row on the shortcut sheet for each place with a key", () => {
		const html = renderToStaticMarkup(
			<ShortcutSheet open onOpenChange={() => {}} />,
		);
		for (const p of PLACES) {
			if (p.goKey) expect(html).toContain(`Go to ${p.label}`);
			else expect(html).not.toContain(`Go to ${p.label}`);
		}
	});

	it("gives every place an icon and a route", () => {
		for (const p of PLACES) {
			expect(p.icon).toBeTruthy();
			expect(p.to.startsWith("/")).toBe(true);
		}
	});
});
