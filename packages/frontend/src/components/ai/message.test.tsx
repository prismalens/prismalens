// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { shellLine } from "./message";

const block = (lang: string, text: string) =>
	createElement("code", { className: `language-${lang}` }, text);

describe("shellLine", () => {
	it("offers a one-line shell block to the terminal, without its prompt sign", () => {
		expect(
			shellLine(block("bash", "$ kubectl rollout restart deploy/api\n")),
		).toBe("kubectl rollout restart deploy/api");
	});

	it("leaves other languages and several lines alone", () => {
		expect(shellLine(block("json", "{}"))).toBeNull();
		expect(shellLine(block("sh", "cd api\nnpm test"))).toBeNull();
		expect(shellLine("plain text")).toBeNull();
	});
});
