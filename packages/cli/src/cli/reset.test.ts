// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import consola from "consola";
import { describe, expect, it, vi } from "vitest";
import resetCommand, { refuseReason } from "./reset.js";

describe("refuseReason", () => {
	const base = mkdtempSync(join(tmpdir(), "pl-reset-"));

	it("allows a directory holding prismalens.db", () => {
		const ws = join(base, "ws");
		mkdirSync(ws);
		writeFileSync(join(ws, "prismalens.db"), "");
		expect(refuseReason(ws)).toBe(null);
	});

	it("refuses a directory without the database", () => {
		const other = join(base, "other");
		mkdirSync(other);
		expect(refuseReason(other)).toMatch(/not a PrismaLens workspace/);
	});

	it("refuses a missing directory", () => {
		expect(refuseReason(join(base, "gone"))).toMatch(/does not exist/);
	});

	it("refuses the home directory and the filesystem root, even with a database", () => {
		const home = join(base, "home");
		mkdirSync(home);
		writeFileSync(join(home, "prismalens.db"), "");
		expect(refuseReason(home, home)).toMatch(/not a workspace directory/);
		expect(refuseReason(parse(base).root, home)).toMatch(
			/not a workspace directory/,
		);
	});

	it("refuses when lock is held by a live pid, keeping directory intact", async () => {
		const ws = join(base, "ws-live");
		mkdirSync(ws);
		writeFileSync(join(ws, "prismalens.db"), "");
		writeFileSync(
			join(ws, "prismalens.lock"),
			JSON.stringify({
				pid: process.pid,
				port: 6473,
				startedAt: new Date().toISOString(),
			}),
		);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined as never));
		const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => {});
		try {
			await resetCommand.run!({
				args: { yes: true, workspace: ws },
				rawArgs: [],
				cmd: resetCommand,
			});
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringMatching(
					/PrismaLens is running on this workspace \(pid \d+, port 6473\)\. Stop it first\./,
				),
			);
			expect(existsSync(ws)).toBe(true);
		} finally {
			exitSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});

	it("proceeds when lock is stale", async () => {
		const ws = join(base, "ws-stale");
		mkdirSync(ws);
		writeFileSync(join(ws, "prismalens.db"), "");
		writeFileSync(
			join(ws, "prismalens.lock"),
			JSON.stringify({
				pid: 999999999,
				port: 6473,
				startedAt: new Date().toISOString(),
			}),
		);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined as never));
		try {
			await resetCommand.run!({
				args: { yes: true, workspace: ws },
				rawArgs: [],
				cmd: resetCommand,
			});
			expect(exitSpy).not.toHaveBeenCalled();
			expect(existsSync(ws)).toBe(false);
		} finally {
			exitSpy.mockRestore();
		}
	});
});
