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

/** The header's primary on every list screen, the phone's included (#673 w11). */
export function NewIncidentButton({ className }: { className?: string }) {
	const open = useNewIncident();
	return (
		<Hint label="New incident" keys={[NEW_INCIDENT_KEY.toUpperCase()]}>
			<Button
				variant="secondary"
				className={cn("pl-2.5", className)}
				onClick={open}
				data-testid="create-incident-button"
			>
				<Plus />
				New incident
			</Button>
		</Hint>
	);
}
