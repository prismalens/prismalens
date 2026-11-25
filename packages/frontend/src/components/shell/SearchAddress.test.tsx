// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SearchAddress } from "./SearchAddress";

const calls: string[] = [];
const navigate = vi.fn((opts: { to: string; replace?: boolean }) => {
	calls.push(`navigate ${opts.to} replace=${opts.replace}`);
	return Promise.resolve();
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/app-commands", () => ({
	runAppCommand: (id: string) => {
		calls.push(`command ${id}`);
		return true;
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("the /search address", () => {
	it("replaces itself with Home, then opens the Search palette", async () => {
		const host = document.createElement("div");
		const root = createRoot(host);
		await act(async () => root.render(<SearchAddress />));
		expect(calls).toEqual(["navigate / replace=true", "command search"]);
		expect(host.textContent).toBe("");
		await act(async () => root.unmount());
	});
});
