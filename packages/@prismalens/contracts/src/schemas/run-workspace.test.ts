// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	DEFAULT_RUN_WORKSPACE_SETTINGS,
	RunWorkspaceOverrideSchema,
	RunWorkspaceSettingsSchema,
} from "./run-workspace.js";

describe("run workspace settings (#925)", () => {
	it("keeps a run's workspace until its incident is resolved by default", () => {
		expect(DEFAULT_RUN_WORKSPACE_SETTINGS.retention).toEqual({
			kind: "keep-until-resolved",
		});
	});

	it("has no automatic cap on kept workspaces", () => {
		expect(Object.keys(RunWorkspaceSettingsSchema.shape)).not.toContain(
			"keptPerProject",
		);
	});

	it("a stored global setting with the old cap still parses, without it", () => {
		const parsed = RunWorkspaceSettingsSchema.parse({
			...DEFAULT_RUN_WORKSPACE_SETTINGS,
			keptPerProject: 10,
		});
		expect(parsed).toEqual(DEFAULT_RUN_WORKSPACE_SETTINGS);
	});

	it("a stored service override with the old cap still parses, without it", () => {
		const parsed = RunWorkspaceOverrideSchema.parse({
			method: "clone",
			keptPerProject: 3,
		});
		expect(parsed).toEqual({ method: "clone" });
	});
});
