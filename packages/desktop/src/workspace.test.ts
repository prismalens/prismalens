// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWorkspaceDir } from "./workspace.js";

describe("defaultWorkspaceDir", () => {
	it("builds the workspace path with win32 backslashes without mixed slashes", () => {
		const ws = defaultWorkspaceDir("C:\\Users\\sumit", {}, path.win32);
		expect(ws).toBe("C:\\Users\\sumit\\.prismalens");
		expect(ws).not.toContain("/");
	});

	it("honours PRISMALENS_WORKSPACE_DIR", () => {
		expect(
			defaultWorkspaceDir("C:\\Users\\sumit", {
				PRISMALENS_WORKSPACE_DIR: "D:\\custom",
			}),
		).toBe("D:\\custom");
	});
});
