// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** The generic webhook call for this workspace; the token stays a placeholder. */
export interface AlertTestCurlData {
	text: string;
}

export const alertTestCurl = define.block<AlertTestCurlData>({
	id: "alertTest.curl",
	label: "Webhook call",
	copyLabel: "Copy curl",
	fold: "read",
	text: (d) => d.text,
	marks: [],
	states: { default: "block-next-command", phone: "block-next-command" },
});

/** The call a real alert source makes; copy it, put your token where `<TOKEN>` is. */
export function genericCurl(url: string, serviceName: string): string {
	const body = JSON.stringify({
		title: "Checkout is failing",
		severity: "high",
		serviceName,
	});
	return [
		`curl -X POST ${url}`,
		`  -H "Authorization: Bearer <TOKEN>"`,
		`  -H "Content-Type: application/json"`,
		`  -d '${body}'`,
	].join(" \\\n");
}
