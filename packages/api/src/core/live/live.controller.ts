// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { liveContract } from "@prismalens/contracts";
import { liveChanges } from "./live-changes.js";

@Controller()
export class LiveController {
	@Implement(liveContract)
	liveRoutes() {
		return {
			changes: implement(liveContract.changes).handler(({ signal }) =>
				liveChanges.subscribe(signal),
			),
		};
	}
}
