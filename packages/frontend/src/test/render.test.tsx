// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/orpc-client";
import { renderWithApp, unacknowledged } from "./render";

function Probe({ id }: { id: string }) {
	const query = useQuery(orpc.alerts.get.queryOptions({ input: { id } }));
	if (query.error)
		return (
			<p data-testid="error">
				{query.error.name}: {query.error.message}
			</p>
		);
	return <p data-testid="title">{(query.data as { title?: string })?.title}</p>;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("renderWithApp (#1154)", () => {
	it("answers a mapped route with its value and the path's id", async () => {
		const app = await renderWithApp(<Probe id="a1" />, {
			api: { "alerts.get": ({ params }) => ({ title: `alert ${params.id}` }) },
		});
		await settle();
		await app.rerender(<Probe id="a1" />);

		expect(
			app.container.querySelector('[data-testid="title"]')?.textContent,
		).toBe("alert a1");
		expect(app.calls).toEqual(["alerts.get"]);
	});

	it("rejects an unmapped route with an error naming that route", async () => {
		const app = await renderWithApp(<Probe id="a2" />, {
			api: { "alerts.list": [] },
		});
		await settle();
		await app.rerender(<Probe id="a2" />);

		expect(
			app.container.querySelector('[data-testid="error"]')?.textContent,
		).toBe(
			"UnmockedApiRouteError: unit tests have no API: GET /api/alerts/a2 (alerts.get) is not in the api map (mapped: alerts.list)",
		);
		expect(app.calls).toEqual([]);
		// The refused request is held for teardown until the test says it expected it.
		expect(app.unmocked).toEqual(["GET /api/alerts/a2 (alerts.get)"]);
		expect(unacknowledged([app])).toEqual(["GET /api/alerts/a2 (alerts.get)"]);
		expect(app.acknowledgeUnmocked()).toEqual([
			"GET /api/alerts/a2 (alerts.get)",
		]);
		expect(unacknowledged([app])).toEqual([]);
	});
});
