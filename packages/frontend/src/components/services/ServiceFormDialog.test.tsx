// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceFormDialog } from "./ServiceFormDialog";

const create = vi.fn();
const addSource = vi.fn();
const idle = { isPending: false, error: null };

vi.mock("@/lib/api/hooks", () => ({
	useCreateService: () => ({ ...idle, mutateAsync: create }),
	useUpdateService: () => ({ ...idle, mutateAsync: vi.fn() }),
	useAddRepositorySource: () => ({ ...idle, mutateAsync: addSource }),
}));

const typeInto = (el: HTMLInputElement | null, value: string) => {
	if (!el) throw new Error("no input");
	const set = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	set?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("ServiceFormDialog save mark (#1020)", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		create.mockReset();
		addSource.mockReset();
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	it("shows a cross, not a tick, when git could not read the code", async () => {
		create.mockResolvedValue({ id: "svc" });
		addSource.mockResolvedValue({ syncError: "not found" });
		act(() => root.render(<ServiceFormDialog open onOpenChange={() => {}} />));
		const inputs = document.querySelectorAll<HTMLInputElement>(
			'[data-testid="service-form-dialog"] input',
		);
		act(() => typeInto(inputs[0] ?? null, "shop"));
		act(() =>
			typeInto(
				document.querySelector<HTMLInputElement>(
					'[data-testid="service-repository-input"]',
				),
				"https://example.com/acme/shop.git",
			),
		);
		const save = Array.from(document.querySelectorAll("button")).find(
			(b) => b.textContent === "Create service",
		);
		await act(async () => {
			save?.click();
		});
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			"not found",
		);
		expect(
			document.querySelector("[data-ring]")?.getAttribute("data-ring"),
		).toBe("failed");
	});
});
