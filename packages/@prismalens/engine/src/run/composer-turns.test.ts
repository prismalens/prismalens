// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createSteerChannel,
	parseAgentCommands,
	promptParts,
	withAddendum,
} from "./investigate.js";

describe("queued messages can be edited or withdrawn until claimed (#1024)", () => {
	it("edits and withdraws a queued line; once claimed, a change returns null", () => {
		const ch = createSteerChannel();
		ch.send("first", "queue", undefined, "m1");
		ch.send("second", "queue", undefined, "m2");
		ch.port.queued?.();
		expect(ch.change("m1", "first, edited")).toBe("edited");
		expect(ch.change("m2", null)).toBe("withdrawn");
		expect(ch.port.changes?.()).toEqual([
			{ id: "m1", text: "first, edited" },
			{ id: "m2", text: null },
		]);
		expect(ch.port.next()?.text).toBe("first, edited");
		// Claimed: the race is lost, the caller answers 409.
		expect(ch.change("m1", "too late")).toBeNull();
		expect(ch.port.next()).toBeNull();
	});

	it("a line changed before it was recorded is recorded as it now stands, with no change event", () => {
		const ch = createSteerChannel();
		ch.send("draft", "queue", undefined, "m1");
		expect(ch.change("m1", "final")).toBe("edited");
		expect(ch.port.changes?.()).toEqual([]);
		expect(ch.port.queued?.().map((l) => l.text)).toEqual(["final"]);
	});
});

describe("the agent's advertised commands (#1024)", () => {
	it("maps available_commands_update, dropping what does not fit", () => {
		expect(
			parseAgentCommands({
				sessionUpdate: "available_commands_update",
				availableCommands: [
					{ name: "review", description: "Review the diff", input: { hint: "path" } },
					{ name: "x".repeat(65), description: "too long a name" },
					{ name: "plan", description: "d".repeat(500) },
					{ description: "no name" },
				],
			}),
		).toEqual([
			{ name: "review", description: "Review the diff", inputHint: "path" },
			{ name: "plan", description: "d".repeat(200) },
		]);
		expect(parseAgentCommands({ sessionUpdate: "available_commands_update" })).toBeNull();
	});
});

describe("attachments too big to inline reach the agent as a resource_link (#1024)", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-link-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const pdf = () => {
		const path = join(dir, "src.pdf");
		writeFileSync(path, "%PDF-1.4 bytes");
		return {
			id: "0b3c2f1e-1111-4222-8333-444455556666",
			name: "runbook v2.pdf",
			mimeType: "application/pdf",
			size: 14,
			path,
		};
	};

	it("without a run-scoped folder, links prismalens://attachment/<id> for pl_attachment_read", () => {
		const parts = promptParts("read this", [pdf()]);
		expect(parts[1]).toEqual({
			type: "resource_link",
			uri: "prismalens://attachment/0b3c2f1e-1111-4222-8333-444455556666",
			name: "runbook v2.pdf",
			mimeType: "application/pdf",
			size: 14,
		});
		expect(parts[0]).toMatchObject({ type: "text" });
		expect((parts[0] as { text: string }).text).toContain("pl_attachment_read");
	});

	it("with the run-scoped folder, copies the file there and links its file:// URI", () => {
		const runDir = join(dir, "runs", "r1", "attachments");
		const [, link] = promptParts("read this", [pdf()], { dir: runDir });
		const uri = (link as { uri: string }).uri;
		expect(uri.startsWith("file://")).toBe(true);
		const copied = fileURLToPath(uri);
		expect(copied.startsWith(runDir)).toBe(true);
		expect(readFileSync(copied, "utf8")).toBe("%PDF-1.4 bytes");
	});

	it("a small text file still goes inline", () => {
		const path = join(dir, "a.log");
		writeFileSync(path, "ERROR pool");
		const parts = promptParts("see", [
			{ id: "x", name: "a.log", mimeType: "text/plain", size: 10, path },
		]);
		expect(parts).toHaveLength(1);
		expect((parts[0] as { text: string }).text).toContain("ERROR pool");
	});

	it("a message's quotes and references follow its text for the agent", () => {
		expect(withAddendum("why?", { addendum: "> pool\n> — from x" })).toBe(
			"why?\n\n> pool\n> — from x",
		);
		expect(withAddendum("why?", undefined)).toBe("why?");
	});
});
