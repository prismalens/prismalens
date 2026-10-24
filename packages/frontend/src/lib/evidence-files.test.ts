// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspace } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { RunStep } from "@/components/run/run-steps";
import {
	citationText,
	citedFile,
	codeHostUrl,
	linesWord,
	locate,
	readsOf,
	sizeWord,
	stepFile,
	unavailableSentence,
} from "./evidence-files";

const sha = "a1b2c3d4e5f678901234567890abcdef12345678";
const sha7 = sha.slice(0, 7);

const ws: RunWorkspace = {
	layout: "single",
	cwd: "/ws/repo",
	repos: [
		{
			name: "checkout-api",
			dir: "/ws/repo",
			sourceKind: "url",
			url: "https://github.com/acme/checkout-api.git",
			subPath: null,
			connectionId: null,
			head: sha,
			branch: "main",
			services: [],
		},
	],
};

describe("locate", () => {
	it("parses line and end line from colon and hash ranges", () => {
		expect(locate("src/db/pool.ts:41-42", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 41,
			end: 42,
		});
		expect(locate("src/db/pool.ts#L41-L42", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 41,
			end: 42,
		});
	});

	it("handles a single line and clamped inverted ranges", () => {
		expect(locate("src/db/pool.ts:41", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 41,
			end: 41,
		});
		expect(locate("src/db/pool.ts:42-41", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 42,
			end: 42,
		});
	});

	it("locates an absolute path under the repo dir", () => {
		expect(locate("/ws/repo/src/db/pool.ts", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: null,
			end: null,
		});
	});

	it("rejects path traversal with null", () => {
		expect(locate("src/../../etc/passwd", ws)).toBeNull();
	});

	it("returns null when no workspace is provided", () => {
		expect(locate("src/db/pool.ts:41-42", null)).toBeNull();
		expect(locate("src/db/pool.ts:41-42", undefined)).toBeNull();
	});
});

describe("citedFile", () => {
	it("extracts and locates a cited file path with line numbers from source text", () => {
		expect(citedFile("cat src/db/pool.ts:12", ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 12,
			end: 12,
		});
	});

	it("returns null when source names no file", () => {
		expect(citedFile("no file mentioned here", ws)).toBeNull();
	});
});

describe("linesWord and citationText", () => {
	it("formats single line, range, and null linesWord", () => {
		expect(linesWord({ line: 41, end: 41 })).toBe("line 41");
		expect(linesWord({ line: 41, end: 42 })).toBe("lines 41-42");
		expect(linesWord({ line: null, end: null })).toBeNull();
	});

	it("formats citationText with path, line range, and short sha", () => {
		expect(
			citationText({
				repo: "checkout-api",
				sha,
				path: "src/db/pool.ts",
				line: 41,
				end: 42,
			}),
		).toBe(`src/db/pool.ts, lines 41-42, as cloned at ${sha7}`);
	});
});

describe("codeHostUrl", () => {
	const fileAt: Parameters<typeof codeHostUrl>[1] = {
		repo: "checkout-api",
		sha,
		path: "src/db/pool.ts",
		line: 41,
		end: 42,
	};

	it("formats GitHub URLs for https and ssh repos", () => {
		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "https://github.com/acme/checkout-api.git" },
				fileAt,
			),
		).toBe(`https://github.com/acme/checkout-api/blob/${sha}/src/db/pool.ts#L41-L42`);

		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "git@github.com:acme/checkout-api.git" },
				fileAt,
			),
		).toBe(`https://github.com/acme/checkout-api/blob/${sha}/src/db/pool.ts#L41-L42`);
	});

	it("formats GitLab URLs with /-/blob/ and #Lstart-end", () => {
		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "https://gitlab.com/acme/checkout-api.git" },
				fileAt,
			),
		).toBe(`https://gitlab.com/acme/checkout-api/-/blob/${sha}/src/db/pool.ts#L41-42`);
	});

	it("formats Bitbucket URLs with /src/ and #lines-start:end", () => {
		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "https://bitbucket.org/acme/checkout-api.git" },
				fileAt,
			),
		).toBe(`https://bitbucket.org/acme/checkout-api/src/${sha}/src/db/pool.ts#lines-41:42`);
	});

	it("returns null for folder source or unknown host", () => {
		expect(
			codeHostUrl(
				{ sourceKind: "folder", url: "https://github.com/acme/checkout-api.git" },
				fileAt,
			),
		).toBeNull();

		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "https://unknownhost.com/acme/checkout-api.git" },
				fileAt,
			),
		).toBeNull();
	});

	it("omits range suffix for a single line", () => {
		const singleLineFile = { ...fileAt, line: 41, end: 41 };
		expect(
			codeHostUrl(
				{ sourceKind: "url", url: "https://github.com/acme/checkout-api.git" },
				singleLineFile,
			),
		).toBe(`https://github.com/acme/checkout-api/blob/${sha}/src/db/pool.ts#L41`);
	});
});

describe("stepFile and readsOf", () => {
	const stepBase = {
		callId: "call-1",
		title: "read file",
		command: "read src/db/pool.ts",
		ok: true,
		unfinished: false,
		output: "content",
		at: "2026-10-21T00:00:00Z",
		took: 1,
		input: null,
	};

	it("returns a FileAt only for file kind with verb Read and a path", () => {
		const validStep: RunStep = {
			...stepBase,
			n: 1,
			kind: "file",
			verb: "Read",
			path: "src/db/pool.ts",
			line: 10,
		};
		expect(stepFile(validStep, ws)).toEqual({
			repo: "checkout-api",
			sha,
			path: "src/db/pool.ts",
			line: 10,
			end: 10,
		});

		const commandStep: RunStep = {
			...stepBase,
			n: 2,
			kind: "command",
			verb: "Read",
			path: "src/db/pool.ts",
		};
		expect(stepFile(commandStep, ws)).toBeNull();

		const writeStep: RunStep = {
			...stepBase,
			n: 3,
			kind: "file",
			verb: "Wrote",
			path: "src/db/pool.ts",
		};
		expect(stepFile(writeStep, ws)).toBeNull();

		const noPathStep: RunStep = {
			...stepBase,
			n: 4,
			kind: "file",
			verb: "Read",
			path: null,
		};
		expect(stepFile(noPathStep, ws)).toBeNull();
	});

	it("lists step numbers of read steps matching the target repo and path", () => {
		const steps: RunStep[] = [
			{
				...stepBase,
				n: 3,
				kind: "file",
				verb: "Read",
				path: "src/db/pool.ts",
			},
			{
				...stepBase,
				n: 5,
				kind: "file",
				verb: "Read",
				path: "src/other.ts",
			},
			{
				...stepBase,
				n: 8,
				kind: "file",
				verb: "Read",
				path: "src/db/pool.ts",
			},
		];

		expect(readsOf({ repo: "checkout-api", path: "src/db/pool.ts" }, steps, ws)).toEqual([3, 8]);
	});
});

describe("unavailableSentence", () => {
	it("returns expected sentence for each unavailable reason", () => {
		expect(unavailableSentence("source-removed", sha)).toBe(
			"The source this run cloned is gone: its folder was removed, or the mirror was pruned.",
		);
		expect(unavailableSentence("commit-gone", sha)).toBe(
			`Commit ${sha7} is no longer in the repository.`,
		);
		expect(unavailableSentence("not-retained", sha)).toBe(
			`Not in the clone at ${sha7}. The path may have been created during the run, be untracked, or not exist.`,
		);
		expect(unavailableSentence("not-a-file", sha)).toBe(
			`At ${sha7} this path is a folder or a submodule, not a file.`,
		);
	});
});

describe("sizeWord", () => {
	it("formats byte sizes into KB and MB strings", () => {
		expect(sizeWord(812 * 1024)).toBe("812 KB");
		expect(sizeWord(2.3 * 1024 * 1024)).toBe("2.3 MB");
		expect(sizeWord(1024 * 1024)).toBe("1 MB");
	});
});
