// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer } from "node:http";

interface Episode {
	labels: Record<string, string>;
	startsAt: number;
	endsAt: number | null;
}

/** Answers catch-up's `ALERTS` and `ALERTS_FOR_STATE` range queries from episodes the test edits. */
export async function startFakePrometheus() {
	const episodes: Episode[] = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://fake");
		const send = (body: unknown) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (url.pathname === "/-/ready") return send("ok");
		if (url.pathname !== "/api/v1/query_range") {
			res.writeHead(404).end();
			return;
		}
		const start = Number(url.searchParams.get("start"));
		const end = Number(url.searchParams.get("end"));
		const step = Number(url.searchParams.get("step"));
		const forState = url.searchParams.get("query") === "ALERTS_FOR_STATE";
		const result = episodes.flatMap((e) => {
			const values: Array<[number, string]> = [];
			const last = Math.min(end, e.endsAt ?? end);
			for (
				let t = Math.max(start, Math.ceil(e.startsAt / step) * step);
				t <= last;
				t += step
			) {
				values.push([t, forState ? String(e.startsAt) : "1"]);
			}
			if (values.length === 0) return [];
			const metric = forState
				? { __name__: "ALERTS_FOR_STATE", ...e.labels }
				: { __name__: "ALERTS", alertstate: "firing", ...e.labels };
			return [{ metric, values }];
		});
		send({ status: "success", data: { resultType: "matrix", result } });
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const { port } = server.address() as { port: number };
	return {
		url: `http://127.0.0.1:${port}`,
		firing(labels: Record<string, string>, startsAt: Date) {
			episodes.push({
				labels,
				startsAt: Math.floor(startsAt.getTime() / 1000),
				endsAt: null,
			});
		},
		ended(labels: Record<string, string>, at: Date) {
			const open = episodes.find(
				(e) =>
					e.endsAt === null &&
					JSON.stringify(e.labels) === JSON.stringify(labels),
			);
			if (open) open.endsAt = Math.floor(at.getTime() / 1000);
		},
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
}
