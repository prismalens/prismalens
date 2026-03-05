import { Github, Link2, MessageSquare, Zap } from "lucide-react";

export function getIntegrationIcon(templateId: string, className = "h-5 w-5") {
	if (templateId.startsWith("github")) return <Github className={className} />;
	if (templateId.startsWith("slack"))
		return <MessageSquare className={className} />;
	if (templateId.startsWith("prometheus"))
		return <Zap className={className} />;
	return <Link2 className={className} />;
}
