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
			changes: implement(liveContract.changes).handler(({ signal }) =>
				withBeat(liveChanges.subscribe(signal), STREAM_BEAT_MS, signal),
			),
		};
	}
}
