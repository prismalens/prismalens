import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

interface MutationErrorProps {
	error: Error | null | undefined;
	className?: string;
}

export function MutationError({ error, className }: MutationErrorProps) {
	if (!error) return null;

	return (
		<Alert variant="destructive" className={cn(className)}>
			<AlertCircle className="h-4 w-4" />
			<AlertDescription>{getErrorMessage(error)}</AlertDescription>
		</Alert>
	);
}
