// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Controller,
	Get,
	Logger,
	Param,
	ParseUUIDPipe,
	Res,
	UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Response } from "express";
import { BoundedSseWriter } from "./sse-writer.js";
// biome-ignore lint/style/useImportType: Nest's DI needs the runtime class reference.
import { StreamRelayService } from "./stream-relay.service.js";

/**
 * SSE endpoint for real-time investigation stream events.
 *
 * Forwards the canonical investigation event stream (CanonicalEvent) as JSON via SSE,
 * then a final `{ type: "done" }` marker.
 *
 * Written against the raw response rather than Nest's `@Sse()` on purpose: `@Sse()` wraps
 * an Observable and gives the handler no access to `res.write`'s return value, so there
 * is no way to notice a client that stopped draining. Every frame goes through
 * {@link BoundedSseWriter}, which does. The wire format is byte-identical to what
 * `@Sse()` produced for a `{ data }` message (`data: <json>\n\n`), so clients are
 * unaffected.
 */
@Controller("api/investigations")
@UseGuards(ThrottlerGuard)
export class InvestigationStreamController {
	private readonly logger = new Logger(InvestigationStreamController.name);

	constructor(private readonly streamRelay: StreamRelayService) {}

	@Get(":id/stream")
	stream(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// Tell any intermediary not to buffer the stream into uselessness.
			"X-Accel-Buffering": "no",
		});
		res.flushHeaders?.();

		const writer = new BoundedSseWriter(res, {
			onLag: () =>
				this.logger.warn(
					`Dropped a lagging SSE subscriber for investigation ${id} — it must resync from the durable event record`,
				),
		});

		const { unsubscribe } = this.streamRelay.subscribe(
			id,
			(event) => {
				writer.send(JSON.stringify(event));
				// A dropped subscriber has no reason to keep a relay subscription open.
				if (writer.isClosed) unsubscribe();
			},
			() => {
				// Final marker so the client knows the stream ended cleanly.
				writer.send(JSON.stringify({ type: "done" }));
				setTimeout(() => writer.close(), 100);
			},
		);

		res.on("close", () => {
			unsubscribe();
			writer.close();
		});
	}
}
