// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monogramOf, ProjectMark } from "./ProjectMark";

let mockHostImages = true;

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useHostImages: () => mockHostImages,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const fireEvent = {
	error: (element: Element) => {
		act(() => {
			element.dispatchEvent(new Event("error"));
		});
	},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mockHostImages = true;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ProjectMark", () => {
	it("renders img element with data-mark image when images are on and iconUrl is set", async () => {
		mockHostImages = true;

		await act(async () => {
			root.render(<ProjectMark name="acme/api" iconUrl="https://x/a.png" />);
		});

		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("https://x/a.png");
		expect(img?.getAttribute("data-mark")).toBe("image");
	});

	it("renders monogram A and no img when images are off with iconUrl set", async () => {
		mockHostImages = false;

		await act(async () => {
			root.render(<ProjectMark name="acme/api" iconUrl="https://x/a.png" />);
		});

		expect(container.querySelector("img")).toBeNull();
		const mark = container.querySelector('[data-testid="project-mark"]');
		expect(mark?.getAttribute("data-mark")).toBe("monogram");
		expect(mark?.textContent).toBe("A");
	});

	it("renders monogram when iconUrl is absent and falls back to monogram on image error", async () => {
		await act(async () => {
			root.render(<ProjectMark name="acme/api" iconUrl={null} />);
		});

		expect(container.querySelector("img")).toBeNull();
		const absentMark = container.querySelector('[data-testid="project-mark"]');
		expect(absentMark?.getAttribute("data-mark")).toBe("monogram");
		expect(absentMark?.textContent).toBe("A");

		await act(async () => {
			root.render(<ProjectMark name="acme/api" iconUrl="https://x/a.png" />);
		});

		const img = container.querySelector("img");
		expect(img).not.toBeNull();
		fireEvent.error(img as HTMLImageElement);

		expect(container.querySelector("img")).toBeNull();
		const fallbackMark = container.querySelector(
			'[data-testid="project-mark"]',
		);
		expect(fallbackMark?.getAttribute("data-mark")).toBe("monogram");
		expect(fallbackMark?.textContent).toBe("A");
	});

	it("derives monogram character across directory paths and punctuation", () => {
		expect(monogramOf("acme/.github")).toBe("G");
		expect(monogramOf("C:\\code\\shop")).toBe("S");
		expect(monogramOf("42-things")).toBe("4");
		expect(monogramOf("---")).toBe("?");
	});
});
