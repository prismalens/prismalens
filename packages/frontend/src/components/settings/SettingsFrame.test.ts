// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { listedIntegrations } from "./SettingsFrame";

const holder = { id: "i1", templateId: "git-host-token", label: "Git host token" };
const prom = { id: "i2", templateId: "prometheus", label: "lab" };
const slackish = { id: "i3", templateId: "other", label: "Other" };

describe("listedIntegrations (w8-5)", () => {
	it("drops the token holder once its last token is removed", () => {
		expect(listedIntegrations([holder, prom, slackish], [])).toEqual([
			slackish,
		]);
	});

	it("lists the token holder while it holds a token", () => {
		expect(listedIntegrations([holder], [{ integrationId: "i1" }])).toEqual([
			holder,
		]);
	});
});
