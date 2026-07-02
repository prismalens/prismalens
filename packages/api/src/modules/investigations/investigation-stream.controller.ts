import {
	Controller,
	type MessageEvent,
	Param,
	ParseUUIDPipe,
	Sse,
	UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Observable } from "rxjs";
import { StreamRelayService } from "./stream-relay.service.js";

/**
 * SSE endpoint for real-time investigation stream events.
 *
 * Forwards the canonical investigation event stream (CanonicalEvent) as JSON via
 * SSE, then a final { type: "done" } marker. Raw NestJS controller (not oRPC,
 * since SSE doesn't fit RPC).
 */
@Controller("api/investigations")
@UseGuards(ThrottlerGuard)
export class InvestigationStreamController {
	constructor(private readonly streamRelay: StreamRelayService) {}

	@Sse(":id/stream")
	stream(@Param("id", ParseUUIDPipe) id: string): Observable<MessageEvent> {
		return new Observable((subscriber) => {
			const { unsubscribe } = this.streamRelay.subscribe(
				id,
				(event) => {
					subscriber.next({ data: JSON.stringify(event) });
				},
				() => {
					// Final marker so the client knows the stream ended cleanly.
					subscriber.next({ data: JSON.stringify({ type: "done" }) });
					setTimeout(() => subscriber.complete(), 100);
				},
			);

			return () => unsubscribe();
		});
	}
}
