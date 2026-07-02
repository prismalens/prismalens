import { IsUUID } from "class-validator";

export class LinkDeploymentDto {
	@IsUUID()
	serviceId!: string;
}
