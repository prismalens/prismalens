// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type PermissionRequest,
	readOnlyPolicy,
	readOnlyPolicyFor,
} from "./permission.js";

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
			"ls src/../../..",
			"cat /bin/../etc/shadow",
			"cat /bin\\..\\..\\etc\\shadow",
			`cat ${cwd}/../../other/secret`,
			"head --lines=3 ../transcript.jsonl",
			"ls -la $PWD/..",
			"cat ${PWD}/../transcript.jsonl",
			"cat $REPO/../x",
			"type ..\\..\\transcript.jsonl",
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
			"cat ./src/../package.json",
			`ls ${cwd}/src/../server`,
			"echo $PWD",
			"grep -rn $PATTERN src/",
			"cat package.json 2>/dev/null",
			"/usr/bin/env node -v",
			"ls /usr/bin/",
		]) {
			expect(policy(req({ kind: "execute", rawInput: { command } })), command).toEqual({ allow: true, optionId: "once" });
		}
		expect(policy(req({ kind: "execute", rawInput: { command: "ls", cwd: "/work/runs/abc" } })).allow).toBe(false);
		expect(policy(req({ kind: "read", rawInput: { filePath: "/etc/passwd" } })).allow).toBe(false);
		expect(policy(req({ kind: "read", rawInput: { filePath: `${cwd}/../transcript.jsonl` } })).allow).toBe(false);
		expect(policy(req({ kind: "read", rawInput: { filePath: "src/../README.md" } })).allow).toBe(true);
		expect(policy(req({ kind: "read", rawInput: { filePath: `${cwd}/README.md` } })).allow).toBe(true);
		expect(readOnlyPolicy(req({ kind: "execute", rawInput: { command: "ls .." } })).allow).toBe(true);
	});

	it("never picks allow_always", () => {
		const d = readOnlyPolicy({ options: [options[1], options[0]], toolCall: { kind: "read" } });
		expect(d).toEqual({ allow: true, optionId: "once" });
	});
});

describe.skipIf(process.platform === "win32")(
	"readOnlyPolicyFor judges the real path (CVE-2026-39861 shape)",
	() => {
		// Skipped on Windows only because creating a symlink there needs a privilege; CI's test jobs are ubuntu and macos.
		let base: string;
		let cwd: string;
		let cwdLink: string;
		beforeAll(() => {
			base = mkdtempSync(join(realpathSync(tmpdir()), "pl-perm-"));
			cwd = join(base, "runs", "abc", "repo");
			mkdirSync(join(cwd, "src"), { recursive: true });
			writeFileSync(join(cwd, "src", "index.ts"), "");
			writeFileSync(join(base, "secret"), "s");
			symlinkSync(join(base, "secret"), join(cwd, "link")); // file symlink out of the snapshot
			symlinkSync(base, join(cwd, "docs"), "dir"); // directory symlink out
			symlinkSync(join(cwd, "src"), join(cwd, "alias"), "dir"); // symlink that stays inside
			cwdLink = join(base, "repo-link");
			symlinkSync(cwd, cwdLink, "dir"); // the snapshot reached through a symlink
		});
		afterAll(() => rmSync(base, { recursive: true, force: true }));

		it("refuses paths pointing outside the snapshot through symlinks", () => {
			const policy = readOnlyPolicyFor({ cwd });
			for (const command of [
				"cat link",
				"cat ./link",
				"head docs/secret",
				"ls docs/..",
				"cat docs/../x",
				`ls ${cwd}/docs/..`,
			]) {
				const d = policy(req({ kind: "execute", rawInput: { command } }));
				expect(d.allow, command).toBe(false);
				expect(!d.allow && d.why, command).toMatch(/outside the snapshot/);
			}
			for (const filePath of [
				"link",
				`${cwd}/link`,
				"docs/secret",
				"docs/..",
				"docs/../x",
				`${cwd}/docs/..`,
			]) {
				const d = policy(req({ kind: "read", rawInput: { filePath } }));
				expect(d.allow, filePath).toBe(false);
				expect(!d.allow && d.why, filePath).toMatch(/outside the snapshot/);
			}
		});

		it("judges an unquoted glob or brace by what the shell expands it to (#685)", () => {
			const policy = readOnlyPolicyFor({ cwd });
			for (const command of [
				"cat *",
				"cat l*",
				"cat ?ink",
				"cat [l]ink",
				"ls */..",
				"head d*/secret",
				"cat {link,src/index.ts}",
				"cat src/{..,.}/link",
				"ls .*",
				"ls src/.?",
				"cat {1..3}",
			]) {
				const d = policy(req({ kind: "execute", rawInput: { command } }));
				expect(d.allow, command).toBe(false);
				expect(!d.allow && d.why, command).toMatch(/outside the snapshot/);
			}
			const inside = readOnlyPolicyFor({ cwd: join(cwd, "src") });
			for (const [p, command] of [
				[inside, "cat *"],
				[inside, "ls *.ts"],
				[policy, "cat src/*.ts"],
				[policy, "grep -rn 'a.*b' src/"],
				[policy, 'grep -E "l[i]nk|d.cs" src/'],
				[policy, "cat \\*"],
				[policy, "cat src/*.md"],
				[policy, "[ -f src/index.ts ] && echo yes"],
				[policy, "find src -name '*.ts' -exec head {} \\;"],
			] as const) {
				expect(p(req({ kind: "execute", rawInput: { command } })), command).toEqual({ allow: true, optionId: "once" });
			}
		});

		it("closes the review's holes: escaped quotes, POSIX classes, runaway stars, backslash names (#685)", () => {
			symlinkSync(base, join(cwd, "b\\d"), "dir"); // a directory symlink out, named with a backslash
			const policy = readOnlyPolicyFor({ cwd });
			for (const command of [
				"echo \\'; cat *",
				'echo \\"; cat l*',
				"cat [[:lower:]]ink",
				"cat 'b\\d'/secret",
				"cat b*/secret",
			]) {
				const d = policy(req({ kind: "execute", rawInput: { command } }));
				expect(d.allow, command).toBe(false);
				expect(!d.allow && d.why, command).toMatch(/outside the snapshot/);
			}
			const trailing = policy(req({ kind: "execute", rawInput: { command: "ls src\\" } }));
			expect(trailing).toEqual({ allow: true, optionId: "once" });

			const stars = `cat src/${"*".repeat(200)}x`;
			const started = Date.now();
			policy(req({ kind: "execute", rawInput: { command: stars } }));
			expect(Date.now() - started).toBeLessThan(1_000);
		});

		it("allows paths not existing yet, symlinks resolving inside, and cwd reached through a symlink", () => {
			const policy = readOnlyPolicyFor({ cwd });
			expect(
				policy(req({ kind: "read", rawInput: { filePath: "new/file.md" } })),
				"new/file.md",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(req({ kind: "execute", rawInput: { command: "cat src/new.ts" } })),
				"cat src/new.ts",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(req({ kind: "read", rawInput: { filePath: "alias/x.ts" } })),
				"alias/x.ts",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(
					req({
						kind: "execute",
						rawInput: { command: "cat alias/index.ts" },
					}),
				),
				"cat alias/index.ts",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(req({ kind: "execute", rawInput: { command: "ls alias/.." } })),
				"ls alias/..",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(req({ kind: "execute", rawInput: { command: "ls src" } })),
				"ls src",
			).toEqual({ allow: true, optionId: "once" });
			expect(
				policy(
					req({
						kind: "execute",
						rawInput: { command: "cat src/index.ts" },
					}),
				),
				"cat src/index.ts",
			).toEqual({ allow: true, optionId: "once" });

			const linkPolicy = readOnlyPolicyFor({ cwd: cwdLink });
			expect(
				linkPolicy(
					req({
						kind: "read",
						rawInput: { filePath: `${cwdLink}/README.md` },
					}),
				),
				`${cwdLink}/README.md`,
			).toEqual({ allow: true, optionId: "once" });
			expect(
				linkPolicy(
					req({
						kind: "read",
						rawInput: { filePath: `${cwd}/README.md` },
					}),
				),
				`${cwd}/README.md`,
			).toEqual({ allow: true, optionId: "once" });
		});
	},
);
