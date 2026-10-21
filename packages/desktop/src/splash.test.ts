// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { splashHtml, startWithSplash } from "./splash.js";

describe("startWithSplash", () => {
	it("opens the main window and closes the splash only after onFirstShow", async () => {
		const order: string[] = [];
		let firstShowCallback: (() => void) | undefined;

		const deps = {
			showSplash: vi.fn(() => {
				order.push("showSplash");
				return {
					close: () => {
						order.push("splash.close");
					},
				};
			}),
			boot: vi.fn(async () => {
				order.push("boot");
			}),
			openMain: vi.fn((onFirstShow: () => void) => {
				order.push("openMain");
				firstShowCallback = onFirstShow;
			}),
			refuse: vi.fn(async () => {
				order.push("refuse");
			}),
		};

		await startWithSplash(deps);

		expect(order).toEqual(["showSplash", "boot", "openMain"]);
		expect(firstShowCallback).toBeDefined();

		firstShowCallback!();
		expect(order).toEqual(["showSplash", "boot", "openMain", "splash.close"]);
		expect(deps.refuse).not.toHaveBeenCalled();
	});

	it("closes splash and calls refuse with error when boot rejects", async () => {
		const order: string[] = [];
		const bootError = new Error("boot failure");

		const deps = {
			showSplash: vi.fn(() => {
				order.push("showSplash");
				return {
					close: () => {
						order.push("splash.close");
					},
				};
			}),
			boot: vi.fn(async () => {
				order.push("boot");
				throw bootError;
			}),
			openMain: vi.fn(() => {
				order.push("openMain");
			}),
			refuse: vi.fn(async (err: unknown) => {
				order.push("refuse");
				expect(err).toBe(bootError);
			}),
		};

		await startWithSplash(deps);

		expect(order).toEqual(["showSplash", "boot", "splash.close", "refuse"]);
		expect(deps.openMain).not.toHaveBeenCalled();
		expect(deps.refuse).toHaveBeenCalledWith(bootError);
	});

	it("closes splash and calls refuse when openMain throws", async () => {
		const order: string[] = [];
		const openError = new Error("openMain failure");

		const deps = {
			showSplash: vi.fn(() => {
				order.push("showSplash");
				return {
					close: () => {
						order.push("splash.close");
					},
				};
			}),
			boot: vi.fn(async () => {
				order.push("boot");
			}),
			openMain: vi.fn(() => {
				order.push("openMain");
				throw openError;
			}),
			refuse: vi.fn(async (err: unknown) => {
				order.push("refuse");
				expect(err).toBe(openError);
			}),
		};

		await startWithSplash(deps);

		expect(order).toEqual(["showSplash", "boot", "openMain", "splash.close", "refuse"]);
		expect(deps.refuse).toHaveBeenCalledWith(openError);
	});
});

describe("splashHtml", () => {
	it("renders dark and light html correctly", () => {
		const darkHtml = splashHtml("dark", "data:x");
		expect(darkHtml).toContain("Starting…");
		expect(darkHtml).toContain("#09090b");
		expect(darkHtml).toContain("data:x");

		const lightHtml = splashHtml("light", "data:x");
		expect(lightHtml).toContain("#fafafa");
	});
});
