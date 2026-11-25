import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

const trimOptional = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class ForceGenerateInsightsDto {
    @IsObject({ message: 'Métricas inválidas para análise.' })
    metrics: Record<string, unknown>;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    accountId?: string;
}

export class CreateAiChatSessionDto {
    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    id?: string | null;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    accountId?: string | null;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(180)
    title?: string | null;

    @IsOptional()
    @IsIn(['pt', 'en'])
    locale?: 'pt' | 'en';
}

export class MarkChatJobPresenceDto {
    @IsOptional()
    @IsBoolean()
    away?: boolean;
}

export class SendAiChatMessageDto {
    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    sessionId?: string | null;

    @Transform(trimOptional)
    @IsString({ message: 'Informe uma mensagem válida.' })
    @MinLength(1, { message: 'A mensagem não pode estar vazia.' })
    @MaxLength(6000, { message: 'A mensagem excede o limite de 6000 caracteres.' })
    message: string;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    accountId?: string | null;

    @IsOptional()
    @IsBoolean()
    async?: boolean;

    @IsOptional()
    @IsIn(['pt', 'en'])
    locale?: 'pt' | 'en';
}

export class RecordMessageSignalDto {
    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    signal?: string;
}

export class SubmitMessageFeedbackDto {
    @IsIn([1, -1], { message: 'Avaliação deve ser positiva (1) ou negativa (-1).' })
    rating: 1 | -1;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(64)
    reasonCode?: string | null;

    @IsOptional()
    @Transform(trimOptional)
    @IsString()
    @MaxLength(2000)
    correctionNote?: string | null;

    @IsOptional()
    @IsIn(['pt', 'en'])
    locale?: 'pt' | 'en';
}
