// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CopyButton } from "@/components/shared/CopyButton";
import { useWebhookToken, webhookUrl } from "@/lib/api/hooks/use-webhooks-orpc";

/** Copy URL, and Copy token on the host only: the token is read by this control, never sent to an agent (#1020). */
export function WebhookCopy({
	testIdPrefix,
	buttonClassName,
}: {
	testIdPrefix: string;
	buttonClassName?: string;
}) {
	const { data: token } = useWebhookToken();
	return (
		<>
			<CopyButton
				value={webhookUrl("prometheus")}
				label="Copy URL"
				testId={`${testIdPrefix}-copy-url`}
				className={buttonClassName}
			/>
			{token && (
				<CopyButton
					value={token.token}
					label="Copy token"
					testId={`${testIdPrefix}-copy-token`}
					className={buttonClassName}
				/>
			)}
		</>
	);
}
