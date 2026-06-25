import { Controller, Param, ParseUUIDPipe, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Observable } from "rxjs";
import { StreamRelayService } from "./stream-relay.service.js";

/**
 * SSE endpoint for real-time investigation stream events.
 *
 * Forwards raw LangGraph [mode, data] tuples as JSON via SSE.
 * This is a raw NestJS controller (not oRPC) since SSE doesn't fit RPC.
 */
// NOTE: a global "api" prefix is applied app-wide, so this controller path must NOT
// repeat it (else the route becomes /api/api/investigations/:id/stream).
@Controller("investigations")
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
					// Send a final "done" event so the client knows the stream ended
					subscriber.next({ data: JSON.stringify(["__done__", {}]) });
					setTimeout(() => subscriber.complete(), 100);
				},
			);

			return () => unsubscribe();
		});
	}
}
