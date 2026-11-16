// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { PANEL_WIDTH_KEY } from "@/lib/person-settings";
import { appearancePanelWidth } from "./appearance.settings";

describe("appearancePanelWidth", () => {
	it("stores under the key the panel shell reads at first paint", () => {
		expect(appearancePanelWidth.key).toBe("pl.panelWidth");
		expect(PANEL_WIDTH_KEY).toBe("pl.panelWidth");
	});
});
