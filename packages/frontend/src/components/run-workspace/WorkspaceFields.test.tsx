// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspaceSettings } from "@prismalens/contracts";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { FieldEditor } from "./WorkspaceFields";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY: RunWorkspaceSettings = {
	method: "worktree",
	location: null,
	retention: { kind: "remove-unless-changed" },
	setup: {},
	teardown: {},
	copyIn: [],
	submodules: "skip",
	branch: "detached",
};

it("Files to copy in keeps a new line while typing a second path", async () => {
	let saved: string[] = [];
	function Host() {
		const [value, setValue] = useState<RunWorkspaceSettings>(EMPTY);
		return createElement(FieldEditor, {
			field: "copyIn",
			value,
			defaultLocation: "",
			onChange: (field, v) => {
				if (field === "copyIn") saved = v as string[];
				setValue((s) => ({ ...s, [field]: v }));
			},
		});
	}
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => root.render(createElement(Host)));
	const area = container.querySelector("textarea") as HTMLTextAreaElement;
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	// One key at a time, each on top of what the box shows, as a user types.
	for (const key of ".env\nconfig/local.json")
		await act(async () => {
			setValue?.call(area, area.value + key);
			area.dispatchEvent(new Event("input", { bubbles: true }));
		});
	expect(area.value).toBe(".env\nconfig/local.json");
	expect(saved).toEqual([".env", "config/local.json"]);
	await act(async () => root.unmount());
	container.remove();
});
