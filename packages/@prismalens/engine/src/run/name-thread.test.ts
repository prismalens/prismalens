// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	claudeProbeIsolation,
	codexProbeIsolation,
} from "@prismalens/agent-host";
import { CheckNotIsolatedError } from "./harness-doctor.js";
import { nameThread } from "./name-thread.js";

const mocks = vi.hoisted(() => {
	const open = vi.fn(async () => undefined);
	const close = vi.fn(async () => undefined);
	const setConfigOption = vi.fn();
	const prompt = vi.fn();
	const configs: { env: Record<string, string>; sessionMeta?: unknown }[] = [];
	return { open, close, setConfigOption, prompt, configs };
});

vi.mock("../runner/acp-client.js", () => {
	return {
		AcpSession: class MockAcpSession {
			constructor(config: { env: Record<string, string>; sessionMeta?: unknown }) {
				mocks.configs.push(config);
			}
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
		mocks.configs.length = 0;
	});

	it("rejects and sends no prompt when setConfigOption resolves null for the title model", async () => {
		mocks.setConfigOption.mockResolvedValue(null);

		await expect(
			nameThread("claude-code", {
				prompt: "Summarize the issue in 5 words",
				model: "refused-model-1",
				probeIsolation: claudeProbeIsolation,
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

	it("opens its title session with the check isolation: Claude Code's hooks and MCP servers off (#1180 R1)", async () => {
		mocks.setConfigOption.mockResolvedValue(null);
		await nameThread("claude-code", {
			prompt: "p",
			model: "m",
			probeIsolation: claudeProbeIsolation,
		}).catch(() => undefined);
		expect(mocks.configs).toHaveLength(1);
		expect(mocks.configs[0]?.sessionMeta).toEqual({
			claudeCode: {
				options: {
					strictMcpConfig: true,
					settings: { disableAllHooks: true },
				},
			},
		});
		expect(mocks.configs[0]?.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
	});

	it("on Codex, whose switches do not hold through a turn, starts nothing and throws (#1180 R1)", async () => {
		await expect(
			nameThread("codex", { prompt: "p", probeIsolation: codexProbeIsolation }),
		).rejects.toEqual(
			new CheckNotIsolatedError("codex", "its switches do not hold through a turn"),
		);
		expect(mocks.configs).toEqual([]);
	});

	it("on an agent with no check isolation starts nothing and throws, so the thread keeps its title (#1180 R1)", async () => {
		await expect(
			nameThread("cursor", { prompt: "p", probeIsolation: null }),
		).rejects.toEqual(new CheckNotIsolatedError("cursor", "no safe check"));
		expect(mocks.configs).toEqual([]);
		expect(mocks.open).not.toHaveBeenCalled();
	});
});
