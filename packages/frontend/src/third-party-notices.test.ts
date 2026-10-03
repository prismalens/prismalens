// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	packageDirOf,
	readNotice,
	renderNotices,
	resolvePackageDirs,
} from "../third-party-notices.ts";

const root = resolve(__dirname, "..");

describe("third-party notices", () => {
	it("maps a bundled file to its package directory", () => {
		expect(
			packageDirOf("/x/node_modules/.pnpm/a@1/node_modules/@scope/pkg/dist/i.js"),
		).toBe("/x/node_modules/.pnpm/a@1/node_modules/@scope/pkg");
		expect(packageDirOf("/x/src/app.tsx")).toBeUndefined();
	});

	it("lists Tailwind, whose generated CSS has no module id in the bundle", () => {
		const notices = resolvePackageDirs(root, ["tailwindcss"]).map(readNotice);
		const text = renderNotices(notices);
		expect(notices[0]).toMatchObject({ name: "tailwindcss", license: "MIT" });
		expect(text).toContain("Permission is hereby granted");
	});
});
