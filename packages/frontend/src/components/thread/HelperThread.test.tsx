// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelperThread } from "./HelperThread";

const seen: Record<string, unknown>[] = [];
vi.mock("./NewThread", () => ({
	NewThread: (props: Record<string, unknown>) => {
		seen.push(props);
		return <span data-testid="new-thread" />;
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	seen.length = 0;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("HelperThread (#1020)", () => {
	// The lean footer (model alone) is this branch's helper box change; see the commit adding `lean`.
	it("starts a no-subject thread that names its page and nothing else, without taking focus, with the model alone", async () => {
		await act(async () => root.render(<HelperThread place="alerts" />));
		expect(seen.at(-1)).toEqual({
			subject: { kind: "none" },
			branch: null,
			place: "alerts",
			placeholder: "Ask how to send alerts",
			autoFocus: false,
			lean: true,
		});
		expect(
			container
				.querySelector("[data-testid=helper-thread]")
				?.getAttribute("data-place"),
		).toBe("alerts");
	});

	it("words each page's placeholder", async () => {
		await act(async () => root.render(<HelperThread place="services" />));
		expect(seen.at(-1)?.placeholder).toBe("Ask how to add a service");
		await act(async () => root.render(<HelperThread place="schedules" />));
		expect(seen.at(-1)?.placeholder).toBe("Ask how schedules work");
	});
});
