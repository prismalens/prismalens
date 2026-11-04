// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkService } from "./LinkService";

const h = vi.hoisted(() => ({
	page: { data: [] as { id: string; name: string }[], total: 0 },
	asked: [] as unknown[],
	mutation: {} as { onError?: (e: Error) => void },
	mutate: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("@/lib/api/hooks", () => ({
	useServices: (p?: unknown) => {
		h.asked.push(p);
		return { data: h.page };
	},
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		incidents: { update: { mutationOptions: () => ({}) }, key: () => ["i"] },
	},
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useMutation: (o: { onError?: (e: Error) => void }) => {
		h.mutation = o;
		return { mutate: h.mutate, isPending: false };
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.asked = [];
	h.toast.mockReset();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe("LinkService (#1020, review of #1031)", () => {
	it("searches the server once the catalog is longer than one page", async () => {
		h.page = { data: [{ id: "s1", name: "cart" }], total: 1 };
		await act(async () => root.render(<LinkService incidentId="inc-1" />));
		expect(q("incident-link-service-find")).toBeNull();

		h.page = { data: [{ id: "s1", name: "cart" }], total: 120 };
		await act(async () => root.render(<LinkService incidentId="inc-2" />));
		const find = q("incident-link-service-find") as HTMLInputElement;
		expect(find).not.toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(find, "billing");
			find.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(h.asked).toContainEqual({ search: "billing" });
	});

	it("says a failed link failed", async () => {
		h.page = { data: [{ id: "s1", name: "cart" }], total: 1 };
		await act(async () => root.render(<LinkService incidentId="inc-1" />));
		await act(async () => h.mutation.onError?.(new Error("Already linked")));
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Service not linked",
				description: "Already linked",
			}),
		);
		expect(q("incident-link-service")?.textContent).toContain("Link service");
	});
});
