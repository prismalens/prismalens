import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ServiceTier, ServiceType } from '../../../shared/enums/index.js';

/**
 * DTO for creating a service in the catalog.
 * Services are pure logical entities — source tracking lives in Repository and Deployment.
 */
export class CreateServiceDto {
  /** Unique service identifier (e.g., 'api-gateway', 'user-service') */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Human-readable display name */
  @IsOptional()
  @IsString()
  displayName?: string;

  /** Service description */
  @IsOptional()
  @IsString()
  description?: string;

  /** Service type: service, database, queue, cache, gateway, external, infrastructure */
  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;

  /** Service tier for prioritization: tier_1, tier_2, tier_3, tier_4 */
  @IsOptional()
  @IsEnum(ServiceTier)
  tier?: ServiceTier;

  /** Owning team */
  @IsOptional()
  @IsString()
  team?: string;

  /** Slack channel for alerts */
  @IsOptional()
  @IsString()
  slackChannel?: string;

  /** Tags for categorization */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Additional metadata (runbook URL, oncall info, etc.) */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
