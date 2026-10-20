// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { sourceType } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { deviceTokenFrom } from "./sources-client.js";
import {
	draftFromArgs,
	overviewTable,
	probeTable,
	vendorList,
} from "./sources-format.js";

const loki = sourceType("loki");
const github = sourceType("github-token");
if (!loki || !github) throw new Error("descriptors missing");
const noFile = () => {
	throw new Error("no file");
};

describe("draftFromArgs (#848)", () => {
	it("reads a token from the named env var, never argv", () => {
		expect(
			draftFromArgs(loki, { url: "http://loki:3100", tokenEnv: "LOKI_TOKEN", serviceLabel: "app" }, { LOKI_TOKEN: " t " }, noFile),
		).toEqual({
			type: "loki",
			url: "http://loki:3100",
			serviceLabel: "app",
			credential: { kind: "bearer", token: "t" },
		});
		expect(() => draftFromArgs(loki, { url: "http://l", tokenEnv: "NOPE" }, {}, noFile)).toThrow(
			"NOPE is empty or not set",
		);
	});

	it("defaults the URL to the detected one, then the type's own", () => {
		expect(draftFromArgs(loki, {}, {}, noFile, "http://found:3100").url).toBe("http://found:3100");
		expect(draftFromArgs(github, { tokenEnv: "GH" }, { GH: "x" }, noFile).url).toBe("https://api.github.com");
		expect(() => draftFromArgs(loki, {}, {}, noFile)).toThrow(/Pass --url/);
	});

	it("refuses a kind the type does not take", () => {
		expect(() => draftFromArgs(github, { authKind: "none" }, {}, noFile)).toThrow(
			"GitHub takes bearer, not none",
		);
	});

	it("passes --use-detected through without a credential", () => {
		expect(draftFromArgs(github, { useDetected: true }, {}, noFile)).toEqual({
			type: "github-token",
			url: "https://api.github.com",
			useDetected: true,
		});
	});
});

describe("tables", () => {
	it("prints the capability table with the bound host", () => {
		const out = probeTable({
			type: "loki",
			host: "loki:3100",
			ok: false,
			probes: [
				{ id: "labels", capability: "Read labels", need: "required", why: "", ok: true, detail: "42 labels" },
				{ id: "query", capability: "Query logs", need: "required", why: "", ok: false, detail: "403: the credential cannot read this" },
			],
			discovered: { serviceLabel: "service_name" },
		});
		expect(out).toContain("Read labels        required  PASS  42 labels");
		expect(out).toContain("FAIL  403");
		expect(out).toContain("service label: service_name");
		expect(out).toContain("sends the credential only to: loki:3100");
	});

	it("names the blind spot of a category nobody connected, and what was found", () => {
		const out = overviewTable({
			categories: [
				{ category: "logs", status: "not-configured", sources: [], tools: [] },
			],
			detected: [{ type: "prometheus", env: "PROMETHEUS_URL", url: "http://prom:9090" }],
		});
		expect(out).toContain("logs       -");
		expect(out).toContain("Investigations are blind to logs.");
		expect(out).toContain("found Prometheus via PROMETHEUS_URL: pl connect metrics prometheus --url http://prom:9090");
	});

	it("lists vendors per category for --help", () => {
		expect(vendorList()).toBe("metrics: prometheus, alertmanager · logs: loki · scm: github");
	});
});

describe("deviceTokenFrom", () => {
	it("takes this instance's device cookie", () => {
		expect(
			deviceTokenFrom(["other=1; Path=/", "prismalens.device.abc=tok%2Bx; HttpOnly"], "prismalens.device"),
		).toBe("tok+x");
		expect(deviceTokenFrom([], "prismalens.device")).toBeNull();
	});
});
