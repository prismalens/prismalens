// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const alertIntakeAlertWebhook = define.setting({
	id: "alertIntake.alertWebhook",
	page: "alert-intake",
	anchor: "sources-webhook",
	label: "Alert webhook",
	sentence: "The URL and token an alert source posts to.",
	also: "alertmanager webhook",
});
