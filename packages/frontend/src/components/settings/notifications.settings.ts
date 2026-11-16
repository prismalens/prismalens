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

export const notificationsLimits = define.setting({
	id: "notifications.limits",
	page: "notifications",
	anchor: "notify-limits",
	label: "Limits and what leaves this machine",
	sentence:
		"HTTPS, Home Screen on iPhone, push carries ids only, and only Slack posts go out.",
	also: "privacy https ios iphone home screen push data leaves machine",
});
