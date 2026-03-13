import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ServiceSuggestion } from "@prismalens/contracts";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAcceptSuggestion, useServices } from "@/lib/api/hooks";

const SERVICE_TYPES = [
	"service",
	"database",
	"queue",
	"cache",
	"gateway",
	"external",
	"infrastructure",
] as const;

export interface AcceptSuggestionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	suggestion: ServiceSuggestion | null;
	onSuccess?: () => void;
}

export function AcceptSuggestionDialog({
	open,
	onOpenChange,
	suggestion,
	onSuccess,
}: AcceptSuggestionDialogProps) {
	const [type, setType] = useState<string>("");
	const [team, setTeam] = useState("");
	const [linkedServiceId, setLinkedServiceId] = useState<string>("");
	const [error, setError] = useState<string | null>(null);

	const acceptSuggestion = useAcceptSuggestion();

	// For deployment suggestions, allow linking to an existing service
	const { data: servicesResponse } = useServices();
	const existingServices = servicesResponse?.data ?? [];

	const isDeployment = suggestion?.sourceType === "deployment";

	const handleAccept = async () => {
		if (!suggestion) return;

		setError(null);
		try {
			await acceptSuggestion.mutateAsync({
				id: suggestion.id,
				type: type || undefined,
				team: team || undefined,
				linkedServiceId:
					isDeployment && linkedServiceId && linkedServiceId !== "__new__"
						? linkedServiceId
						: undefined,
			});
			onOpenChange(false);
			resetForm();
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to accept suggestion";
			setError(message);
		}
	};

	const resetForm = () => {
		setType("");
		setTeam("");
		setLinkedServiceId("");
		setError(null);
	};

	const handleOpenChange = (next: boolean) => {
		if (!next) resetForm();
		onOpenChange(next);
	};

	if (!suggestion) return null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Accept Suggestion</DialogTitle>
					<DialogDescription>
						{isDeployment
							? "This will create a Deployment record and optionally link it to a service."
							: "This will create a Repository record and a new service."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="rounded-md border p-3 space-y-1">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium">
								{suggestion.displayName ?? suggestion.suggestedName}
							</p>
							<Badge variant="outline" className="text-xs">
								{isDeployment ? "🚀 Deployment" : "🔗 Repository"}
							</Badge>
						</div>
						<p className="text-xs text-muted-foreground">
							{suggestion.repository}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="suggestion-type">Service Type (optional)</Label>
						<Select value={type} onValueChange={setType}>
							<SelectTrigger id="suggestion-type">
								<SelectValue placeholder="Default" />
							</SelectTrigger>
							<SelectContent>
								{SERVICE_TYPES.map((t) => (
									<SelectItem key={t} value={t}>
										{t.charAt(0).toUpperCase() + t.slice(1)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="suggestion-team">Team (optional)</Label>
						<Input
							id="suggestion-team"
							placeholder="e.g. platform-team"
							value={team}
							onChange={(e) => setTeam(e.target.value)}
						/>
					</div>

					{isDeployment && existingServices.length > 0 && (
						<div className="space-y-2">
							<Label htmlFor="link-service">
								Link to existing service (optional)
							</Label>
							<Select
								value={linkedServiceId}
								onValueChange={setLinkedServiceId}
							>
								<SelectTrigger id="link-service">
									<SelectValue placeholder="Create new service" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__new__">Create new service</SelectItem>
									{existingServices.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.displayName || s.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{error && (
						<p className="text-sm text-destructive text-center">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleAccept}
						disabled={acceptSuggestion.isPending}
					>
						{acceptSuggestion.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Accept
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
