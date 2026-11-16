// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const aboutUpdates = define.setting({
	id: "about.updates",
	page: "about",
	anchor: "about-updates",
	label: "Updates",
	sentence: "Version, channel and upgrades.",
	also: "version upgrade release",
});
