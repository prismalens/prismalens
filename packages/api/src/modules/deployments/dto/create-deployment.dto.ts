import { IsArray, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeploymentDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  externalId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  deploymentType?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  repositoryUrl?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  lastDeployedAt?: string;
}

export class BatchCreateDeploymentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeploymentDto)
  deployments!: CreateDeploymentDto[];
}
