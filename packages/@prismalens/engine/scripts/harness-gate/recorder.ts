// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { assertLoopback } from "./env.js";

export interface Recorder {
	url: string;
	/** The `model` field of every JSON request body the harness sent. */
	models: string[];
	close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
	"host",
	"connection",
	"content-length",
	"transfer-encoding",
]);

function forwardHeaders(headers: IncomingHttpHeaders): Headers {
	const out = new Headers();
	for (const [name, value] of Object.entries(headers))
		if (value !== undefined && !HOP_BY_HOP.has(name))
			out.set(name, Array.isArray(value) ? value.join(", ") : value);
	return out;
}

/** A loopback pass-through in front of the model endpoint that records which model each request asked for (R7). */
export async function startRecorder(target: string): Promise<Recorder> {
	assertLoopback(target);
	const models: string[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const body = Buffer.concat(chunks);
		try {
			const model = (JSON.parse(body.toString()) as { model?: unknown }).model;
			if (typeof model === "string") models.push(model);
		} catch {
			// not a JSON body
		}
		try {
			const upstream = await fetch(new URL(req.url ?? "/", target), {
				method: req.method,
				headers: forwardHeaders(req.headers),
				body: body.length > 0 ? body : undefined,
			});
			const headers: Record<string, string> = {};
			upstream.headers.forEach((value, name) => {
				if (!HOP_BY_HOP.has(name) && name !== "content-encoding")
					headers[name] = value;
			});
			res.writeHead(upstream.status, headers);
			if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
			else res.end();
		} catch (e) {
			res.writeHead(502).end(String(e));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		models,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
