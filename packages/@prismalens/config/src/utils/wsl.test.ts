// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isWindowsMountPath, isWsl } from "./wsl.js";

describe("isWsl", () => {
	it("reads WSL_DISTRO_NAME or WSL_INTEROP", () => {
		expect(isWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
		expect(isWsl({ WSL_INTEROP: "/run/WSL/1_interop" })).toBe(true);
		expect(isWsl({})).toBe(false);
		expect(isWsl({ WSL_DISTRO_NAME: "" })).toBe(false);
	});
});

describe("isWindowsMountPath", () => {
	it("matches a mounted drive letter and nothing else", () => {
		expect(isWindowsMountPath("/mnt/c/Users/me/AppData/Roaming/npm/gemini")).toBe(true);
		expect(isWindowsMountPath("/mnt/D")).toBe(true);
		expect(isWindowsMountPath("/mnt/wsl/foo")).toBe(false);
		expect(isWindowsMountPath("/usr/local/bin/gemini")).toBe(false);
		expect(isWindowsMountPath("/home/me/mnt/c/x")).toBe(false);
	});
});
