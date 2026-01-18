import {
	IsArray,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	Min,
} from "class-validator";

export class UpdateLlmDto {
	@IsOptional()
	@IsString()
	apiKey?: string;

	@IsOptional()
	@IsString()
	model?: string;

	@IsOptional()
	@IsString()
	baseUrl?: string;

	// Common LangChain config fields
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(2)
	temperature?: number;

	@IsOptional()
	@IsNumber()
	@Min(1)
	maxTokens?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1)
	topP?: number;

	// Provider-specific fields
	@IsOptional()
	@IsNumber()
	@Min(1)
	topK?: number;

	@IsOptional()
	@IsNumber()
	@Min(-2)
	@Max(2)
	frequencyPenalty?: number;

	@IsOptional()
	@IsNumber()
	@Min(-2)
	@Max(2)
	presencePenalty?: number;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	stopSequences?: string[];
}

export class SetActiveProviderDto {
	@IsNotEmpty()
	@IsString()
	provider: string;
}
