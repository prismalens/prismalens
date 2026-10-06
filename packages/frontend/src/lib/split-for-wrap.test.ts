// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { splitForWrap } from "./split-for-wrap";

describe("splitForWrap", () => {
	it("breaks before a case change", () => {
		expect(splitForWrap("KubePodAnomalyDetected")).toEqual([
			"Kube",
			"Pod",
			"Anomaly",
			"Detected",
		]);
	});

	it("breaks after _ - . /", () => {
		expect(splitForWrap("checkout_api-p99.latency/eu")).toEqual([
			"checkout_",
			"api-",
			"p99.",
			"latency/",
			"eu",
		]);
	});

	it("keeps plain words and runs of capitals whole", () => {
		expect(splitForWrap("Disk full on db-1")).toEqual(["Disk full on db-", "1"]);
		expect(splitForWrap("HTTP 500s")).toEqual(["HTTP 500s"]);
	});

	it("joins back to the input", () => {
		const t = "BooklogrSearchTimeouts on booklogr-api";
		expect(splitForWrap(t).join("")).toBe(t);
	});
});
