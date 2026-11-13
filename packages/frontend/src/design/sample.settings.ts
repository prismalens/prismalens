// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** The gallery's sample setting: the menu it shapes is the sample row's. */
export const sampleSetting = define.setting({
	id: "appearance.sampleMenus",
	page: "appearance",
	label: "Sample menus",
	sentence: "Shows the gallery's sample object with its menus.",
	surfaces: ["sample.row"],
});
