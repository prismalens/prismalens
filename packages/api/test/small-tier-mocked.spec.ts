// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => "mocked child") }));

it("a small test that mocks child_process runs its mock, not the refusal (#1154)", () => {
	expect(spawn("git", ["--version"])).toBe("mocked child");
});
