// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** On for this service unless this service turned it off. */
function isOn(i: ServiceIntegrationWithStatus): boolean {
	return (
		!i.hasOverride ||
		(i.serviceConfig as { enabled?: boolean } | null)?.enabled !== false
	);
}

/**
 * Telemetry (study-v3 §7): the sources a run on this service may query. The
 * brief names each one that is on; turning one off holds it back for this
 * service only.
 */
export function ServiceTelemetrySection({
	serviceId,
	integrations,
}: {
	serviceId: string;
	integrations: ServiceIntegrationWithStatus[];
}) {
	const create = useCreateServiceIntegration();
	const update = useUpdateServiceIntegration();
	const remove = useDeleteServiceIntegration();
	const pending = create.isPending || update.isPending || remove.isPending;
	const observability = integrations.filter(
		(i) => i.category === "observability",
	);
	const toggle = (i: ServiceIntegrationWithStatus) => {
		const on = isOn(i);
		if (on) {
			if (i.overrideId)
				update.mutate({
					id: i.overrideId,
					config: { ...(i.serviceConfig ?? {}), enabled: false },
				});
			else
				create.mutate({
					serviceId,
					connectionId: i.connectionId,
					config: { enabled: false },
				});
		} else if (i.overrideId) {
			remove.mutate({ id: i.overrideId });
		}
	};
	return (
		<RecordSection id="telemetry" title="Telemetry">
			{observability.length === 0 ? (
				<p className="text-body text-text-2">
					None. Add Alertmanager or Prometheus under Settings, Alert sources and
					the brief tells the agent to query it.
				</p>
			) : (
				<ul>
					{observability.map((i) => {
						const on = isOn(i);
						return (
							<li
								key={i.connectionId}
								className="flex items-start gap-3 border-t border-hairline py-2.5 first:border-t-0"
								data-testid="service-telemetry-row"
							>
								<div className="min-w-0 flex-1">
									<p className={cn("text-body", !on && "text-text-3")}>
										{i.connectionName}
									</p>
									<p className="text-meta text-text-3">
										{i.templateName},{" "}
										{on
											? i.status === "ACTIVE"
												? "reachable. The brief tells the agent to query it."
												: "unreachable at the last check."
											: "held back from runs on this service."}
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									disabled={pending}
									onClick={() => toggle(i)}
								>
									{on ? "Turn off here" : "Turn on"}
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</RecordSection>
	);
}
