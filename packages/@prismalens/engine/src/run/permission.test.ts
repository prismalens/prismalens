// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { type PermissionRequest, readOnlyPolicy, readOnlyPolicyFor } from "./permission.js";

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
			{ kind: "fetch", title: "fetch https://example.com" },
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

	it("allows a kind it does not name, with a warning the host logs", () => {
		for (const kind of ["other", undefined]) {
			const d = readOnlyPolicy(req({ kind, title: "mystery tool" }));
			expect(d.allow).toBe(true);
			expect(d.allow && d.warn).toMatch(/does not name: mystery tool/);
		}
		const read = readOnlyPolicy(req({ kind: "read", title: "read a" }));
		expect(read.allow && read.warn).toBeUndefined();
	});

	it("refuses paths outside the snapshot when a cwd is given (#337 run e, G17)", () => {
		const cwd = "/work/runs/abc/repo";
		const policy = readOnlyPolicyFor({ cwd });
		for (const command of [
			"git log --oneline -10; git status; ls -la ..; ls -la ../..",
			"cat ~/.bashrc",
			"ls ~/.ssh",
			"cat /etc/hostname",
			"cat $HOME/.netrc",
			"grep -r token /work/runs/other/transcript.jsonl",
			"cd .. && ls",
		]) {
			const d = policy(req({ kind: "execute", rawInput: { command } }));
			expect(d.allow, command).toBe(false);
			expect(!d.allow && d.why, command).toMatch(/outside the snapshot/);
		}
		for (const command of [
			"pwd; ls -la",
			"git log --oneline -20 -- src/",
			`grep -rn createdAt ${cwd}/server`,
			"ls src/../src",
			"cat package.json 2>/dev/null",
			"/usr/bin/env node -v",
		]) {
			expect(policy(req({ kind: "execute", rawInput: { command } })), command).toEqual({ allow: true, optionId: "once" });
		}
		expect(policy(req({ kind: "execute", rawInput: { command: "ls", cwd: "/work/runs/abc" } })).allow).toBe(false);
		expect(policy(req({ kind: "read", rawInput: { filePath: "/etc/passwd" } })).allow).toBe(false);
		expect(policy(req({ kind: "read", rawInput: { filePath: `${cwd}/README.md` } })).allow).toBe(true);
		expect(readOnlyPolicy(req({ kind: "execute", rawInput: { command: "ls .." } })).allow).toBe(true);
	});

	it("never picks allow_always", () => {
		const d = readOnlyPolicy({ options: [options[1], options[0]], toolCall: { kind: "read" } });
		expect(d).toEqual({ allow: true, optionId: "once" });
	});
});
