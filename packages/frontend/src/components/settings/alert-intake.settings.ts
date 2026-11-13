// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const alertIntakeAlertWebhook = define.setting({
	id: "alertIntake.alertWebhook",
	page: "alert-intake",
	anchor: "sources-webhook",
	label: "Alert webhooks",
	sentence:
		"The URLs an alert source posts to; send the token as the bearer token, the basic-auth password or the HMAC key.",
	also: "alertmanager webhook",
});
