// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { IntegrationsTab } from "./IntegrationsTab";
import { SlackDeliverySettings } from "./SlackDeliverySettings";

/**
 * IntegrationsSettings — admin-level integration management.
 * Renders the IntegrationsTab for registering/deleting provider instances.
 */
export function IntegrationsSettings() {
	return (
		<>
			<SlackDeliverySettings />
			<IntegrationsTab />
		</>
	);
}
