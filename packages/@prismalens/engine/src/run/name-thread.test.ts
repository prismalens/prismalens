// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nameThread } from "./name-thread.js";

const mocks = vi.hoisted(() => {
	const open = vi.fn(async () => undefined);
	const close = vi.fn(async () => undefined);
	const setConfigOption = vi.fn();
	const prompt = vi.fn();
	return { open, close, setConfigOption, prompt };
});

vi.mock("../runner/acp-client.js", () => {
	return {
		AcpSession: class MockAcpSession {
			modelOptionId = "model";
			effort = null;
			servedModel = "default";
			open = mocks.open;
			close = mocks.close;
			setConfigOption = mocks.setConfigOption;
			prompt = mocks.prompt;
		},
	};
});

describe("nameThread (#1171)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects and sends no prompt when setConfigOption resolves null for the title model", async () => {
		mocks.setConfigOption.mockResolvedValue(null);

		await expect(
			nameThread("claude-code", {
				prompt: "Summarize the issue in 5 words",
				model: "refused-model-1",
			}),
		).rejects.toThrow("the agent refused the title model refused-model-1");

		expect(mocks.open).toHaveBeenCalledTimes(1);
		expect(mocks.setConfigOption).toHaveBeenCalledWith(
			"model",
			"refused-model-1",
		);
		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});
});
