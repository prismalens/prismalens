// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeletionImpactSection } from "./DeletionImpactSection";

const empty = { connections: [], repositories: [], affectedServices: [] };

describe("DeletionImpactSection (#831 w6-7)", () => {
	it("says nothing else uses the connection when nothing is affected", () => {
		const html = renderToStaticMarkup(
			<DeletionImpactSection
				impact={empty}
				showConnections={false}
				emptyLine="Nothing else uses this connection."
			/>,
		);
		expect(html).toContain("Nothing else uses this connection.");
		expect(html).not.toContain("cannot be undone");
	});

	it("names a service with its own setting for the connection, in words", () => {
		const html = renderToStaticMarkup(
			<DeletionImpactSection
				impact={{
					...empty,
					affectedServices: [
						{
							id: "00000000-0000-4000-8000-000000000001",
							name: "booklogr-api",
							impact: "integration_override_lost",
						},
					],
				}}
				showConnections={false}
				emptyLine="Nothing else uses this connection."
			/>,
		);
		expect(html).toContain("booklogr-api");
		expect(html).toContain("loses its own setting for this connection");
		expect(html).not.toContain("Nothing else uses");
		expect(html).not.toContain("integration override lost");
	});
});
