// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseStdin } from "./parse-stdin.js";
import { PassThrough } from "node:stream";

describe("parseStdin", () => {
	let originalStdin: NodeJS.ReadStream;

	beforeEach(() => {
		originalStdin = process.stdin;
	});

	afterEach(() => {
		Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
	});

	it("returns undefined if stdin is TTY", async () => {
		const mockStdin = new PassThrough();
		(mockStdin as any).isTTY = true;
		Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });
		
		expect(await parseStdin()).toBeUndefined();
	});

	it("parses valid JSON from stdin", async () => {
		const mockStdin = new PassThrough();
		(mockStdin as any).isTTY = false;
		Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });
		
		mockStdin.write('{"hello": "world"}');
		mockStdin.end();
		
		expect(await parseStdin()).toEqual({ hello: "world" });
	});

	it("throws explicit error on invalid JSON", async () => {
		const mockStdin = new PassThrough();
		(mockStdin as any).isTTY = false;
		Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });
		
		mockStdin.write('{not valid json');
		mockStdin.end();
		
		await expect(parseStdin()).rejects.toThrow(/invalid FiringAlert JSON on stdin:/);
	});
});
