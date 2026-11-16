import {
    IsBoolean,
    IsEmail,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimString = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

const trimLowerEmail = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AdminLoginDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'E-mail administrativo inválido.' })
    @MaxLength(254)
    email: string;

    @IsString()
    @MinLength(1)
    @MaxLength(256)
    pass: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    date?: string;
}

export class AdminVerifyOtpDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'E-mail administrativo inválido.' })
    @MaxLength(254)
    email: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código OTP deve conter 6 dígitos.' })
    otp: string;
}

export class ToggleTrialCampaignDto {
    @IsBoolean()
    enabled: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(365)
    days?: number;
}

export class AdjustUserSubscriptionDto {
    @IsIn(['ASSIGN', 'EXTEND', 'CANCEL'])
    action: 'ASSIGN' | 'EXTEND' | 'CANCEL';

    @IsOptional()
    @IsString()
    @MaxLength(128)
    planConfigId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    tier?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(3650)
    days?: number;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    customExpiryDate?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
