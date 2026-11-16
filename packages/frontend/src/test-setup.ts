// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The app loads the registry and the markdown renderer after a page's first content
// (#1101 category 12); a unit test renders in one pass, so it starts with both.
// The menus' Radix half too: warm in the module cache, a test's act sees its lazy load resolve.
import "@/components/kit/MenuImpl";
import "@/components/kit/PopoverImpl";
import "@/components/kit/SurfaceMenus";
import { beforeAll } from "vitest";
import * as registry from "@/components/kit/registry";
import { primeRegistry } from "@/components/kit/registry-load";
import { primeHintTip } from "@/components/shared/Hint";
import * as hintTip from "@/components/shared/HintTip";
import { alertDialogImpl } from "@/components/ui/alert-dialog";
import { dialogImpl } from "@/components/ui/dialog";
import { primeMarkdown } from "@/lib/markdown-render";
import * as markdown from "@/lib/markdown-render-impl";

primeRegistry(registry);
primeMarkdown(markdown);
primeHintTip(hintTip);
// The dialogs' Radix half and the picker's list load after a test file's own mocks apply.
beforeAll(async () => {
	try {
		dialogImpl.prime(await import("@/components/ui/dialog-impl"));
		alertDialogImpl.prime(await import("@/components/ui/alert-dialog-impl"));
		const { pickerList } = await import("@/components/kit/Picker");
		pickerList.prime(await import("@/components/kit/PickerList"));
	} catch {
		// A file that mocks React whole draws no dialog; its load fails harmlessly.
	}
});
