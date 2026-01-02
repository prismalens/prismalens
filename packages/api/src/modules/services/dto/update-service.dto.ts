import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsObject,
} from 'class-validator';
import { ServiceType, ServiceTier } from '../../../shared/enums/index.js';

/**
 * DTO for updating a service
 */
export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;

  @IsOptional()
  @IsEnum(ServiceTier)
  tier?: ServiceTier;

  @IsOptional()
  @IsString()
  team?: string;

  @IsOptional()
  @IsString()
  slackChannel?: string;

  @IsOptional()
  @IsString()
  repository?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
