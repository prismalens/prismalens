// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Row } from "./RunDetailsPanel";
import type { DetailRow } from "./run-details";

const row: DetailRow = {
	text: "pool exhausted",
	file: { repo: "o/r", path: "src/db.ts", line: 4, sha: "abcdef0123456789" },
};

describe("Row", () => {
	it("renders without file-link props and shows no file link", () => {
		const html = renderToStaticMarkup(
			<Row row={row} incidentId="i1" onJump={() => {}} />,
		);
		expect(html).toContain("pool exhausted");
		expect(html).not.toContain("detail-file");
	});

	it("shows the file link when a viewer is given", () => {
		const html = renderToStaticMarkup(
			<Row
				row={row}
				incidentId="i1"
				onJump={() => {}}
				onOpenFile={() => {}}
				origin="o1"
			/>,
		);
		expect(html).toContain("detail-file");
	});
});
