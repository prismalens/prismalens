// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { type PermissionRequest, readOnlyPolicy } from "./permission.js";

const options = [
	{ optionId: "once", kind: "allow_once" },
	{ optionId: "always", kind: "allow_always" },
	{ optionId: "reject", kind: "reject_once" },
];

const req = (toolCall: PermissionRequest["toolCall"]): PermissionRequest => ({ options, toolCall });

describe("readOnlyPolicy", () => {
	it("allows reads, searches and read-only shell", () => {
		for (const tc of [
			{ kind: "read", title: "read README.md" },
			{ kind: "search", title: "grep foo" },
			{ kind: "execute", title: "pwd", rawInput: { command: "pwd && git rev-parse HEAD" } },
			{ kind: "execute", rawInput: { command: "git log --oneline -20 -- src/" } },
			{ kind: "execute", rawInput: { command: "git branch" } },
			{ kind: "execute", rawInput: { command: "git branch -a" } },
			{ kind: "execute", rawInput: { command: "git branch --show-current" } },
			{ kind: "execute", rawInput: { command: "git tag" } },
			{ kind: "execute", rawInput: { command: "curl -s http://localhost:9090/api/v1/query --data-urlencode 'query=up'" } },
		]) {
			expect(readOnlyPolicy(req(tc))).toEqual({ allow: true, optionId: "once" });
		}
	});

	it("rejects write-kind tools and mutating shell, picking reject_once", () => {
		for (const tc of [
			{ kind: "edit", title: "edit src/a.ts" },
			{ kind: "delete", title: "delete x" },
			{ kind: "move", title: "mv" },
			{ kind: "execute", rawInput: { command: "echo spike > PRISMALENS_SPIKE.txt" } },
			{ kind: "execute", rawInput: { command: "git checkout -b fix" } },
			{ kind: "execute", rawInput: { command: "git branch feature" } },
			{ kind: "execute", rawInput: { command: "git branch -d feature" } },
			{ kind: "execute", rawInput: { command: "git tag v1" } },
			{ kind: "execute", rawInput: { command: "kubectl delete pod x" } },
			{ kind: "execute", rawInput: { command: "sed -i 's/a/b/' f" } },
			{ kind: "execute", rawInput: { command: "curl -X POST http://x/api" } },
			{ kind: "execute", title: "rm -rf build" },
		]) {
			const d = readOnlyPolicy(req(tc));
			expect(d.allow, JSON.stringify(tc)).toBe(false);
			expect(d.optionId).toBe("reject");
		}
	});

	it("never picks allow_always", () => {
		const d = readOnlyPolicy({ options: [options[1], options[0]], toolCall: { kind: "read" } });
		expect(d).toEqual({ allow: true, optionId: "once" });
	});
});
