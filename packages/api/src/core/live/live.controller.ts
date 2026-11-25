// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { liveContract, STREAM_BEAT_MS } from "@prismalens/contracts";
import { withBeat } from "./beat.js";
import { liveChanges } from "./live-changes.js";

@Controller()
export class LiveController {
	@Implement(liveContract)
	liveRoutes() {
		return {
			changes: implement(liveContract.changes).handler(({ input, signal }) => {
				// A beat carries the last cursor this connection sent, never the global one: a beat
				// ahead of a replay would make the client drop that replay as old (#1181).
				const sent = { cursor: input.after ?? liveChanges.cursor() };
				return withBeat(
					liveChanges.subscribe(signal, input.after, sent),
					STREAM_BEAT_MS,
					signal,
					() => ({ beat: true as const, cursor: sent.cursor }),
				);
			}),
		};
	}
}
