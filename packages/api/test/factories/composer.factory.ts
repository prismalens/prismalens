// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Provider } from "@nestjs/common";
import { AsksService } from "../../src/modules/asks/asks.service.js";
import { DraftsService } from "../../src/modules/composer/drafts.service.js";
import { ReferencesService } from "../../src/modules/references/references.service.js";

/**
 * The composer seams a controller spec does not exercise (#1024): no draft, no
 * quotes or references, and asks answered straight through `dispatch`.
 */
export function composerStubs(dispatch: unknown = {}): Provider[] {
	return [
		{
			provide: AsksService,
			useValue: new AsksService(
				{} as never,
				dispatch as never,
				{
					allEvents: async () => [],
				} as never,
			),
		},
		{ provide: DraftsService, useValue: { consume: async () => "none" } },
		{
			provide: ReferencesService,
			useValue: { compose: async () => undefined },
		},
	];
}
