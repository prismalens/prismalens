// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback } from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `c`: Home with Incident on (#1020). */
export const NEW_INCIDENT_KEY = "c";

/** Opens Home with Incident on; the box's text becomes the brief. */
export function useNewIncident() {
	const navigate = useNavigate();
	return useCallback(
		() => void navigate({ to: "/new", search: { incident: true } }),
		[navigate],
	);
}

/** Operations' header primary: an incident logged by hand. */
export function NewIncidentButton({ className }: { className?: string }) {
	const open = useNewIncident();
	return (
		<Hint label="Log incident" keys={[NEW_INCIDENT_KEY.toUpperCase()]}>
			<Button
				variant="secondary"
				className={cn("pl-2.5", className)}
				onClick={open}
				data-testid="create-incident-button"
			>
				<Plus />
				Log incident
			</Button>
		</Hint>
	);
}
