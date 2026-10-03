// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ServiceInvestigationsSection } from "./ServiceInvestigationsSection";

vi.mock("@/lib/api/hooks", () => ({
	useUpdateService: () => ({ mutate: vi.fn(), error: null }),
}));

const render = (metadata: Record<string, unknown> | null) =>
	renderToStaticMarkup(
		React.createElement(ServiceInvestigationsSection, {
			serviceId: "s1",
			metadata,
		}),
	);

describe("ServiceInvestigationsSection", () => {
	it("reads a stored policy", () => {
		expect(render({ investigation: { trigger: "never" } })).toContain(
			"Start none on their own",
		);
	});

	it("reads an unknown or malformed stored policy as the default", () => {
		for (const trigger of ["sometimes", 3, null]) {
			expect(render({ investigation: { trigger } })).toContain(
				"Start one for every critical and high alert",
			);
		}
	});
});
