// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInboxGroups } from "./use-arrivals";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const incident = (number: number, title: string): IncidentWithRelations =>
	({
		id: `i-${number}`,
		number,
		title,
		status: "investigating",
		severity: "high",
		triggeredAt: "2026-10-10T10:00:00Z",
		alertCount: 0,
		alerts: [],
		investigations: [],
	}) as unknown as IncidentWithRelations;

describe("useInboxGroups (#891, #1197)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let seen: { shown: string[]; fresh: string[] };

	function Probe(p: { incidents: IncidentWithRelations[]; filter: string }) {
		const { groups, arrived } = useInboxGroups(p.incidents, p.filter, true);
		seen = {
			shown: groups.flatMap((g) => g.rows.map((r) => r.id)),
			fresh: Array.from(arrived),
		};
		return null;
	}
	const render = (incidents: IncidentWithRelations[], filter: string) =>
		act(async () =>
			root.render(<Probe incidents={incidents} filter={filter} />),
		);

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("shows the filtered rows, and clearing the filter glows none of the rows it had hidden", async () => {
		const both = [incident(1, "alpha"), incident(2, "beta")];
		await render(both, "alpha");
		expect(seen).toEqual({ shown: ["i-1"], fresh: [] });

		await render(both, "");
		expect(seen).toEqual({ shown: ["i-1", "i-2"], fresh: [] });
	});

	it("glows an incident that arrives after the first paint, filtered or not", async () => {
		const both = [incident(1, "alpha"), incident(2, "beta")];
		await render(both, "");
		const three = [...both, incident(3, "gamma")];
		await render(three, "");
		expect(seen.fresh).toEqual(["i-3"]);

		await render(three, "gamma");
		expect(seen).toEqual({ shown: ["i-3"], fresh: ["i-3"] });
	});
});
