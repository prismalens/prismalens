import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import {
	DependencyCriticality,
	DependencyType,
} from "../../../shared/enums/index.js";

/**
 * DTO for adding a service dependency
 */
export class AddDependencyDto {
	/** ID of the service this service depends on */
	@IsString()
	@IsNotEmpty()
	dependencyId!: string;

	/** Dependency type: runtime, build, data */
	@IsOptional()
	@IsEnum(DependencyType)
	dependencyType?: DependencyType;

	/** How critical is this dependency: required, optional, degraded */
	@IsOptional()
	@IsEnum(DependencyCriticality)
	criticality?: DependencyCriticality;
}
