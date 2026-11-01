// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { replaceEqualDeep } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useShared } from "./useInvestigationRun";

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return { ...actual, replaceEqualDeep: vi.fn(actual.replaceEqualDeep) };
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useShared", () => {
	it("compares a new input once, then reuses the result while the same reference comes back", async () => {
		const seen: object[] = [];
		const Probe = ({ value }: { value: object }) => {
			seen.push(useShared(value));
			return null;
		};
		const root = createRoot(document.createElement("div"));
		const a = { steps: [{ n: 1 }] };
		const b = { steps: [{ n: 1 }] };

		await act(async () => root.render(<Probe value={a} />));
		await act(async () => root.render(<Probe value={b} />));
		const afterNewInput = vi.mocked(replaceEqualDeep).mock.calls.length;
		await act(async () => root.render(<Probe value={b} />));
		await act(async () => root.render(<Probe value={b} />));

		expect(vi.mocked(replaceEqualDeep).mock.calls.length).toBe(afterNewInput);
		expect(seen.at(-1)).toBe(a);
		await act(async () => root.unmount());
	});
});
