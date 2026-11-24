// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, it } from "vitest";
import type { Target } from "../../../../scripts/journeys/types.mjs";
import { journeys } from "../../../../scripts/journeys/index.mjs";
import { inProcessTarget } from "./in-process-target.js";

// The journeys are written once in scripts/journeys; the packed and live targets run them from
// scripts/packed-intake.mjs. A journey asserts through node:assert, so this file holds no expect.
let target: Target;

beforeAll(async () => {
	target = await inProcessTarget();
}, 60_000);
afterAll(async () => {
	await target?.cleanup();
});

describe("Core journeys on the in-process target", () => {
	for (const journey of journeys) {
		it(
			journey.title,
			async () => {
				await journey.run(target, {
					log: () => {},
					investigations: [],
				});
			},
			180_000,
		);
	}
});
