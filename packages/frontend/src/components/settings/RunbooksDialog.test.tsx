// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunbooksDialog } from "./RunbooksDialog";

const mutate = vi.fn();
const reset = vi.fn();

vi.mock("@/lib/api/hooks/use-sources-orpc", () => ({
	useSetRunbooks: () => ({
		mutate,
		reset,
		isPending: false,
		error: null,
	}),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

if (typeof Element.prototype.hasPointerCapture === "undefined") {
	Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.scrollIntoView === "undefined") {
	Element.prototype.scrollIntoView = () => {};
}
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mutate.mockClear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	document.body.innerHTML = "";
});

const q = (id: string) =>
	document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function show(source: Parameters<typeof RunbooksDialog>[0]["source"]) {
	await act(async () =>
		root.render(
			<RunbooksDialog source={source} open onOpenChange={() => {}} />,
		),
	);
}

describe("RunbooksDialog (#848)", () => {
	it("is two steps: a toggle, then a confirm with the count and the read-only tools", async () => {
		await show({
			id: "runbooks",
			label: "Runbooks in your repos",
			kind: "builtin",
			status: "connected",
			count: 3,
		});
		expect(q("connect-step")?.textContent).toBe("step 1 of 2");
		expect(q("runbooks-toggle")).not.toBeNull();
		await act(async () => q("runbooks-next")?.click());
		expect(q("connect-step")?.textContent).toBe("step 2 of 2");
		const confirm = q("runbooks-confirm")?.textContent ?? "";
		expect(confirm).toContain("3 found");
		expect(confirm).toContain("runbooks_list");
		expect(confirm).toContain("runbooks_read");
	});

	it("saves through PUT /sources/runbooks with the toggle's value", async () => {
		await show({
			id: "runbooks",
			label: "Runbooks in your repos",
			kind: "builtin",
			status: "not-configured",
			reason: "Turned off.",
		});
		expect(q("runbooks-toggle")?.getAttribute("data-state")).toBe("unchecked");
		await act(async () => q("runbooks-toggle")?.click());
		await act(async () => q("runbooks-next")?.click());
		await act(async () => q("runbooks-submit")?.click());
		expect(mutate).toHaveBeenCalledWith({ enabled: true }, expect.any(Object));
	});
});
