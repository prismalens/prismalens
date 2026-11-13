// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const devicesDevices = define.setting({
	id: "devices.devices",
	page: "devices",
	anchor: "devices-list",
	label: "Paired devices",
	sentence: "Phones and computers paired with this instance.",
	also: "phone pair revoke",
});
