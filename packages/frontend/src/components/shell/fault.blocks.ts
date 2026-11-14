// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A crash's technical detail behind a fault notice's Details, copied whole into a report. */
export const faultDetailBlock = define.block<{ detail: string }>({
	id: "fault.detail",
	label: "Error details",
	copyLabel: "Copy details",
	text: (d) => d.detail,
	marks: [],
	states: { default: "app-faults", phone: "app-faults" },
});
