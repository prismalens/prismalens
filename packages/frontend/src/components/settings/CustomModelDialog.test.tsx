// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CustomModelDialog, editedModel } from "./CustomModelDialog";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("editedModel (#1180)", () => {
	it("trims the name, keeps labels in their fixed order, and drops empty fields", () => {
		expect(editedModel("gw", "  Gateway  ", ["large-context", "fast"])).toEqual(
			{
				id: "gw",
				name: "Gateway",
				labels: ["fast", "large-context"],
			},
		);
		expect(editedModel("gw", "   ", [])).toEqual({ id: "gw" });
	});
});

describe("CustomModelDialog (#1180)", () => {
	it("saves the name and the ticked label for the model it opened on", async () => {
		const onSave = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		await act(async () =>
			root.render(
				<CustomModelDialog
					model={{ id: "gw-a", labels: ["fast"] }}
					onOpenChange={() => {}}
					onSave={onSave}
				/>,
			),
		);
		const q = (id: string) =>
			document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement;
		expect(document.body.textContent).toContain("Edit name and options");
		const name = q("custom-model-name") as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(name, "Gateway A");
			name.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => q("custom-model-label-no-reasoning").click());
		await act(async () => q("custom-model-save").click());
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave).toHaveBeenCalledWith({
			id: "gw-a",
			name: "Gateway A",
			labels: ["no-reasoning", "fast"],
		});
		await act(async () => root.unmount());
	});
});
