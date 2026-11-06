// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { compose, onCompose } from "./compose";

describe("compose", () => {
	it("hands the text to the composer listening, until it stops listening", () => {
		const got = vi.fn();
		const stop = onCompose(got);
		compose("What lasting fix would stop this?");
		stop();
		compose("ignored");
		expect(got).toHaveBeenCalledTimes(1);
		expect(got).toHaveBeenCalledWith("What lasting fix would stop this?");
	});
});
