// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const appearanceColorScheme = define.setting({
	id: "appearance.colorScheme",
	page: "appearance",
	anchor: "appearance-scheme",
	label: "Color scheme",
	sentence: "Light, dark or the system's.",
	also: "theme dark mode",
});

export const appearanceInterfaceFont = define.setting({
	id: "appearance.interfaceFont",
	page: "appearance",
	anchor: "appearance-typography",
	label: "Interface font",
	sentence: "The font the app's words use.",
	also: "typography",
});
