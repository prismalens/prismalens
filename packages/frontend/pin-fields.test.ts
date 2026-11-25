// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pinFields } from "./pin-fields.ts";

const transform = (code: string, id: string) => {
	const hook = pinFields().transform as (
		code: string,
		id: string,
	) => { code: string; map: null } | null;
	return hook(code, id);
};

const source = (agent: string) =>
	readFileSync(
		new URL(
			`../@prismalens/providers/src/agent/${agent}/pin.json`,
			import.meta.url,
		),
		"utf8",
	);

describe("pinFields", () => {
	it("drops the CI-only fields and keeps what a descriptor reads", () => {
		const pin = {
			cli: { package: "a", version: "1.0.0", channel: "pypi", bin: "a" },
			adapter: { package: "b", version: "2.0.0" },
			with: ["c"],
			constraints: ["d<1"],
			why: "e",
			minimumReleaseAgeDays: 7,
			tested: { version: "1.0.0", date: "2026-01-01" },
			tier: 2,
		};
		const out = transform(
			JSON.stringify(pin),
			"/repo/packages/@prismalens/providers/dist/agent/a/pin.json",
		);
		expect(JSON.parse(out?.code ?? "")).toEqual({
			cli: { package: "a", version: "1.0.0", channel: "pypi", bin: "a" },
			with: ["c"],
			tested: { version: "1.0.0", date: "2026-01-01" },
		});
	});

	it("reads a real pin by its Windows path in the providers source", () => {
		const out = transform(
			source("deepagents"),
			"C:\\repo\\packages\\@prismalens\\providers\\src\\agent\\deepagents\\pin.json",
		);
		const { cli, with: extras, tested } = JSON.parse(source("deepagents"));
		expect(JSON.parse(out?.code ?? "")).toEqual({
			cli,
			with: extras,
			tested,
		});
	});

	it("leaves any other JSON untouched", () => {
		expect(transform('{"why":"e"}', "/repo/src/pin.json")).toBeNull();
	});
});
