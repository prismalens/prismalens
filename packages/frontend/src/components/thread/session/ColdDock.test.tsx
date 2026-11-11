// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColdDock, coldSendFields } from "./ColdDock";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("coldSendFields", () => {
	it.each([
		["compact" as const, { compact: true }],
		["send" as const, {}],
		["fresh" as const, { fresh: true }],
	])("coldSendFields(%s) gives %j", (choice, expected) => {
		expect(coldSendFields(choice)).toEqual(expected);
	});
});

describe("ColdDock", () => {
	it.each([
		["cold-dock-compact", "compact" as const],
		["cold-dock-send", "send" as const],
		["cold-dock-fresh", "fresh" as const],
	])(
		"with canCompact true, clicking %s calls onChoose with %s",
		async (testid, choice) => {
			const onChoose = vi.fn();
			await act(async () =>
				root.render(
					<ColdDock tokens={50_000} canCompact={true} onChoose={onChoose} />,
				),
			);
			const button = container.querySelector(
				`[data-testid="${testid}"]`,
			) as HTMLButtonElement;
			await act(async () => {
				button.click();
			});
			expect(onChoose).toHaveBeenCalledTimes(1);
			expect(onChoose).toHaveBeenCalledWith(choice);
		},
	);

	it("with canCompact false there is no cold-dock-compact", async () => {
		const onChoose = vi.fn();
		await act(async () =>
			root.render(
				<ColdDock tokens={50_000} canCompact={false} onChoose={onChoose} />,
			),
		);
		expect(
			container.querySelector('[data-testid="cold-dock-compact"]'),
		).toBeNull();
	});

	it("tokens 140000 shows Send as is re-reads about 140k tokens", async () => {
		const onChoose = vi.fn();
		await act(async () =>
			root.render(
				<ColdDock tokens={140_000} canCompact={true} onChoose={onChoose} />,
			),
		);
		const cost = container.querySelector('[data-testid="cold-dock-cost"]');
		expect(cost?.textContent).toBe("Send as is re-reads about 140k tokens");
	});
});
