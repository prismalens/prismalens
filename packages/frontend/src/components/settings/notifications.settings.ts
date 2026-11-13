// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const notificationsNotifications = define.setting({
	id: "notifications.notifications",
	page: "notifications",
	label: "Notifications",
	sentence: "Where findings and asks reach you.",
	also: "slack push alerts",
});
