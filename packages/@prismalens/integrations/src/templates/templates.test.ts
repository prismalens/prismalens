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

	it("rejects userinfo credentials in baseUrl pattern", () => {
		for (const t of [prometheus, alertmanager]) {
			const baseUrlField = t.connectionFields?.find((f) => f.name === "baseUrl");
			expect(baseUrlField?.pattern).toBeDefined();
			const regex = new RegExp(baseUrlField!.pattern!);

			expect(regex.test("http://prometheus.internal:9090")).toBe(true);
			expect(regex.test("https://alertmanager.internal:9093")).toBe(true);
			expect(regex.test("http://localhost:9090")).toBe(true);
			expect(regex.test("https://prometheus.internal:9090/sub/path")).toBe(true);

			expect(regex.test("https://user:pass@host")).toBe(false);
			expect(regex.test("https://user:pass@prometheus.internal:9090")).toBe(false);
			expect(regex.test("http://user@host:9090")).toBe(false);
			expect(regex.test("http://:pass@host:9090")).toBe(false);
			expect(regex.test("https://u:p@h")).toBe(false);
			expect(regex.test("http://host:9090/?api_key=s")).toBe(false);
			expect(regex.test("http://host:9090/#token=s")).toBe(false);
			expect(regex.test("http://host:9090/prometheus")).toBe(true);
		}
	});

	it("explains credentials in URL are not supported in baseUrl description", () => {
		for (const t of [prometheus, alertmanager]) {
			const baseUrlField = t.connectionFields?.find((f) => f.name === "baseUrl");
			expect(baseUrlField?.description).toMatch(
				/credentials and query strings in the url are not supported/i,
			);
			expect(baseUrlField?.description).toMatch(/read-only reverse proxy/i);
		}
	});
});
