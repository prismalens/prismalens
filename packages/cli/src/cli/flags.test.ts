// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import consola from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertKnownFlags } from "./flags.js";

describe("assertKnownFlags", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		errorSpy = vi.spyOn(consola, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("accepts declared flags including hyphenated and their camelCase aliases", () => {
		const cmd = {
			args: {
				"base-dir": { type: "string" },
				"max-turns": { type: "number" },
			},
		};

		assertKnownFlags({ _: [], "base-dir": "foo" }, cmd);
		assertKnownFlags({ baseDir: "foo" }, cmd);
		assertKnownFlags({ "max-turns": 5, maxTurns: 5 }, cmd);

		expect(exitSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("rejects unknown flags", () => {
		const cmd = { args: { foo: { type: "string" } } };

		assertKnownFlags({ unknown: true }, cmd);

		expect(errorSpy).toHaveBeenCalledWith("Unknown option: --unknown");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("rejects prototype properties like toString", () => {
		const cmd = { args: { foo: { type: "string" } } };

		const args = Object.create(Object.prototype);
		args.toString = "some-value"; // own property now, but not in allowedKeys

		assertKnownFlags(args, cmd);

		expect(errorSpy).toHaveBeenCalledWith("Unknown option: --toString");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
