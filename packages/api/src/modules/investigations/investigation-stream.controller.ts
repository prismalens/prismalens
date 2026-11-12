// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Controller,
	Get,
	Headers,
	Logger,
	Optional,
	Param,
	ParseUUIDPipe,
	Query,
	Res,
	UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { parseCursor } from "@prismalens/contracts";
import type { Response } from "express";
import { InvestigationsService } from "./investigations.service.js";
import { BoundedSseWriter } from "./sse-writer.js";
import { StreamRelayService } from "./stream-relay.service.js";
import { ResumableStream } from "./thread-window/resumable-stream.js";
import { ThreadWindowService } from "./thread-window/thread-window.service.js";

/**
 * SSE endpoint for real-time investigation stream events.
 *
 * Forwards the canonical investigation event stream (CanonicalEvent) as JSON via SSE,
 * then a final `{ type: "done" }` marker — but ONLY when the relay can actually vouch
 * that the topic ended. For an UNKNOWN topic the response is ended with no marker at
 * all; see the relay's topic state model and the `onUnknown` wiring below.
 *
 * Written against the raw response rather than Nest's `@Sse()` on purpose: `@Sse()` wraps
 * an Observable and gives the handler no access to `res.write`'s return value, so there
 * is no way to notice a client that stopped draining. Every frame goes through
 * {@link BoundedSseWriter}, which does. The wire format is byte-identical to what
 * `@Sse()` produced for a `{ data }` message (`data: <json>\n\n`), so clients are
 * unaffected.
 */
// `api` is already the global prefix (main.ts `setGlobalPrefix`), so this must NOT
// repeat it. It did, which mapped the route at `/api/api/investigations/:id/stream`
// while the only client calls `/api/investigations/:id/stream` — the live stream has
// been a 404 since the prefix was introduced. Verified against a running server.
@Controller("investigations")
@UseGuards(ThrottlerGuard)
export class InvestigationStreamController {
	private readonly logger = new Logger(InvestigationStreamController.name);

	constructor(
		private readonly streamRelay: StreamRelayService,
		@Optional() private readonly investigations?: InvestigationsService,
		@Optional() private readonly window?: ThreadWindowService,
	) {}

	@Get(":id/stream")
	stream(
		@Param("id", ParseUUIDPipe) id: string,
		@Res() res: Response,
		@Query("v") version?: string,
		@Query("after") after?: string,
		@Headers("last-event-id") lastEventId?: string,
	): void {
		if (version === "2" && this.investigations && this.window) {
			this.resumable(id, res, lastEventId || after);
			return;
		}
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

		// `subscribe` REPLAYS buffered events synchronously, so the handler can run
		// before `subscribe` returns. A `const { unsubscribe }` destructure would be in
		// its temporal dead zone at that point and throw on the first replayed event
		// that closed the writer — hence the mutable handle, initialised first.
		let unsubscribe: () => void = () => {};
		const subscription = this.streamRelay.subscribe(
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
			() => {
				// UNKNOWN topic: this process has no buffer for the id, which is what a
				// finished-and-swept run and a still-running one mid-restart both look
				// like from here. Ending WITHOUT `done` is the honest answer — `done`
				// would assert a clean finish we cannot see, and the client would mark a
				// live investigation completed with no way back (#388). An unclean close
				// raises `EventSource.onerror` in the browser, which is what re-engages
				// the detail page's status polling.
				this.logger.debug(
					`No relay buffer for investigation ${id} — closing the stream without a done marker so the client falls back to polling`,
				);
				writer.close();
			},
		);
		unsubscribe = subscription.unsubscribe;
		// A writer closed during the synchronous replay never got to call the handle.
		if (writer.isClosed) unsubscribe();

		res.on("close", () => {
			unsubscribe();
			writer.close();
		});
	}

	/**
	 * The resumable stream (#1101 cat 12): named, generation-tagged frames, a replay of
	 * the committed rows past `after`, then live. `id:` carries the cursor, so the
	 * browser's own reconnect resumes too.
	 */
	private resumable(
		id: string,
		res: Response,
		after: string | undefined,
	): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.flushHeaders?.();
		const writer = new BoundedSseWriter(res, {
			onLag: () =>
				this.logger.warn(
					`Dropped a lagging SSE subscriber for investigation ${id} — it resumes from its cursor`,
				),
		});
		const investigations = this.investigations as InvestigationsService;
		const window = this.window as ThreadWindowService;
		const relay = this.streamRelay;
		const stream = new ResumableStream(
			{
				head: (t) => window.head(t),
				rows: (t, a, b) => window.rows(t, a, b),
				parseRow: (t, raw) => window.parseRow(t, raw),
				subscribe: (t, onEvent, onDone, onUnknown) =>
					relay.subscribe(t, onEvent, onDone, onUnknown),
				onCommit: (t, fn) => investigations.onCommit(t, fn),
			},
			id,
			after ? parseCursor(after) : null,
			{
				send: (name, data, eventId) =>
					writer.sendNamed(name, JSON.stringify(data), eventId),
				close: () => setTimeout(() => writer.close(), 50),
			},
		);
		res.on("close", () => {
			stream.stop();
			writer.close();
		});
		stream.start().catch((e: unknown) => {
			this.logger.warn(
				`Resumable stream for ${id} failed: ${e instanceof Error ? e.message : String(e)}`,
			);
			stream.stop();
			writer.close();
		});
	}
}
