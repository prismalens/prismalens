// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { CreateIncidentDialog } from "@/components/incidents/CreateIncidentDialog";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The shortcut that opens it, shown in the tooltip and the ? sheet. */
export const NEW_INCIDENT_KEY = "c";

const NewIncidentContext = createContext<() => void>(() => {});

/** The one manual entry (decision 4): every New in the app opens this dialog. */
export function NewIncidentProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const show = useCallback(() => setOpen(true), []);
	const value = useMemo(() => show, [show]);
	return (
		<NewIncidentContext.Provider value={value}>
			{children}
			<CreateIncidentDialog
				open={open}
				onOpenChange={setOpen}
				onCreated={(id) => navigate({ to: "/incidents/$id", params: { id } })}
			/>
		</NewIncidentContext.Provider>
	);
}

export function useNewIncident() {
	return useContext(NewIncidentContext);
}

/** The header's New; on the phone the strip's + stands in for it. */
export function NewIncidentButton({
	className,
	compact,
}: {
	className?: string;
	compact?: boolean;
}) {
	const open = useNewIncident();
	return (
		<Hint label="New incident" keys={[NEW_INCIDENT_KEY.toUpperCase()]}>
			<Button
				size={compact ? "icon" : "default"}
				className={cn(!compact && "pl-2", className)}
				onClick={open}
				aria-label={compact ? "New incident" : undefined}
				data-testid="create-incident-button"
			>
				<Plus />
				{!compact && "New"}
			</Button>
		</Hint>
	);
}
