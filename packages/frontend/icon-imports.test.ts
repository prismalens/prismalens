// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { iconImports } from "./icon-imports.ts";

const transform = (code: string, id: string) => {
	const hook = iconImports().transform as (
		code: string,
		id: string,
	) => { code: string; map: null } | null;
	return hook(code, id);
};

describe("iconImports", () => {
	it("runs in a build only, so the dev server pre-bundles lucide-react once", () => {
		expect(iconImports().apply).toBe("build");
	});

	it("rewrites a barrel import of icons to one deep import per icon", () => {
		expect(
			transform(
				'import { Plus, X as Close } from "lucide-react";\n',
				"/app/src/a.tsx",
			),
		).toEqual({
			code: 'import Plus from "lucide-react/icons/plus";\nimport Close from "lucide-react/icons/x";\n',
			map: null,
		});
	});

	it("leaves a file outside src untouched", () => {
		expect(
			transform('import { X } from "lucide-react";\n', "/app/e2e/a.ts"),
		).toBeNull();
	});
});
