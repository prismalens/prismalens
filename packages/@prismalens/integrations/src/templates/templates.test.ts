// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	alertmanager,
	getAllTemplates,
	getTemplate,
	getTemplatesByCategory,
	prometheus,
} from "./index.js";

describe("observability templates (#633)", () => {
	it("registers prometheus and alertmanager", () => {
		expect(getTemplate("prometheus")).toBe(prometheus);
		expect(getTemplate("alertmanager")).toBe(alertmanager);

		const all = getAllTemplates();
		expect(all).toContain(prometheus);
		expect(all).toContain(alertmanager);

		const observability = getTemplatesByCategory("observability");
		expect(observability).toContain(prometheus);
		expect(observability).toContain(alertmanager);
	});

	it("has no credential fields on purpose (URL only)", () => {
		expect(prometheus.connectionCredentialFields).toEqual([]);
		expect(alertmanager.connectionCredentialFields).toEqual([]);
		expect(prometheus.display?.authModeLabel).toBe("URL only");
		expect(alertmanager.display?.authModeLabel).toBe("URL only");
		expect(prometheus.verify?.path).toBe("/-/ready");
		expect(alertmanager.verify?.path).toBe("/-/ready");
	});
});
