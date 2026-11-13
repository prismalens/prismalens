// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

export const settingsRow = defineSurface({
	id: "settings.row",
	object: "setting",
	label: "Setting actions",
	menus: { context: ["setting.reset", "-", "setting.copyLink"] },
	states: { default: "settings-rows", phone: "settings-rows" },
	marks: [],
});
