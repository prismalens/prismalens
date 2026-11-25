// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { sourceLabel } from "./source-label";

describe("sourceLabel", () => {
	it("names the brief's sections in words", () => {
		expect(sourceLabel("context-pack:PRIOR SIMILAR INCIDENTS")).toBe(
			"Earlier incidents",
		);
		expect(sourceLabel("context-pack:DEPLOY HISTORY")).toBe("Deploy history");
	});

	it("names an alert's field path in words", () => {
		expect(sourceLabel("annotations.summary")).toBe("Alert summary");
		expect(sourceLabel("alert annotations.runbook_url")).toBe(
			"Alert runbook url",
		);
		expect(sourceLabel("labels.service")).toBe("Alert label service");
	});

	it("leaves a path or a query as it is", () => {
		expect(sourceLabel("api/config.py")).toBe("api/config.py");
	});
});
