// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { shellEnv, unpackedPath } from "./pty.js";

const win = (...parts: string[]) => parts.join("\\");

describe("unpackedPath", () => {
	it("points into the desktop archive's unpacked copy, on either separator", () => {
		expect(unpackedPath(win("C:", "app", "prismalens.asar", "prismalens", "x.js"))).toBe(
			win("C:", "app", "prismalens.asar.unpacked", "prismalens", "x.js"),
		);
		expect(unpackedPath("/app/prismalens.asar/prismalens/x.js")).toBe(
			"/app/prismalens.asar.unpacked/prismalens/x.js",
		);
		expect(unpackedPath("/usr/lib/node_modules/prismalens/x.js")).toBeNull();
	});
});

describe("shellEnv", () => {
	it("passes the user's environment minus PrismaLens's own secrets", () => {
		const env = shellEnv({
			PATH: "/bin",
			HOME: "/home/u",
			GITHUB_TOKEN: "gh",
			PRISMALENS_AUTH_SECRET: "s",
			PRISMALENS_ENCRYPTION_KEY: "k",
			PROMETHEUS_TOKEN: "p",
			ELECTRON_RUN_AS_NODE: "1",
		});
		expect(env).toMatchObject({ PATH: "/bin", HOME: "/home/u", GITHUB_TOKEN: "gh", TERM: "xterm-256color" });
		for (const key of ["PRISMALENS_AUTH_SECRET", "PRISMALENS_ENCRYPTION_KEY", "PROMETHEUS_TOKEN", "ELECTRON_RUN_AS_NODE"])
			expect(env).not.toHaveProperty(key);
	});
});
