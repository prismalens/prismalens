// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** The gallery's sample block: the command its sample tool call ran. */
export const sampleCommandBlock = define.block({
	id: "sample.command",
	label: "Sample command",
	copyLabel: "Copy command",
	text: (d: { command: string }) => d.command,
	command: (d) => d.command,
	marks: [],
	states: { default: "menu-object", phone: "menu-object" },
});
