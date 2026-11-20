import {
    IsBoolean,
    IsEmail,
    IsIn,
    IsNumber,
    IsObject,
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

export class LoginDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;

    @IsString()
    @MinLength(1, { message: 'A senha é obrigatória.' })
    @MaxLength(128)
    password: string;
}

export class RefreshTokenDto {
    @Transform(trimString)
    @IsString()
    @MinLength(16)
    @MaxLength(512)
    refreshToken: string;
}

export class SendOtpDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;
}

export class RegisterDto {
    @Transform(trimString)
    @IsString()
    @MinLength(2, { message: 'Nome deve ter pelo menos 2 caracteres.' })
    @MaxLength(120)
    name: string;

    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código OTP deve conter 6 dígitos.' })
    otp: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
    @MaxLength(128)
    password: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    contact?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    whatsapp?: string;

    @IsOptional()
    @IsIn(['pt', 'en'])
    preferredLocale?: 'pt' | 'en';

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(64)
    timezone?: string;

    @IsOptional()
    @IsObject()
    attributionData?: Record<string, unknown>;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(120)
    visitorId?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    referralCode?: string;
}

export class ForgotPasswordDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;
}

export class ResetPasswordDto {
    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código de recuperação deve conter 6 dígitos.' })
    code: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(2048)
    token?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(256)
    sig?: string;

    @IsString()
    @MinLength(8, { message: 'A nova senha deve ter no mínimo 8 caracteres.' })
    @MaxLength(128)
    newPassword: string;
}

export class Verify2faDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(2048)
    twoFactorToken?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(2048)
    userId?: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código 2FA deve conter 6 dígitos.' })
    otp: string;
}

export class Resend2faDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(2048)
    twoFactorToken?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(2048)
    userId?: string;
}

export class UpdateProfileDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    username?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    avatarUrl?: string | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100000000)
    dailyLossLimit?: number;
}

export class UpdateContactDto {
    @Transform(trimString)
    @IsString()
    @Matches(/^\+?[0-9\s()-]{6,24}$/, {
        message: 'Informe um contacto móvel válido com indicativo do país.',
    })
    whatsapp: string;
}

export class UpdatePreferencesDto {
    @IsOptional()
    @IsIn(['pt', 'en'])
    preferredLocale?: 'pt' | 'en';

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(64)
    timezone?: string;

    @IsOptional()
    @IsObject()
    attributionData?: Record<string, unknown>;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(120)
    visitorId?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    referralCode?: string;
}

export class Update2faDto {
    @IsBoolean()
    enabled: boolean;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código 2FA deve conter 6 dígitos.' })
    code?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    password?: string;
}

export class Verify2faSetupDto {
    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código de configuração 2FA deve conter 6 dígitos.' })
    token: string;
}

export class OnboardingSurveyDto {
    @IsOptional()
    @IsIn(['beginner', 'intermediate', 'advanced', 'pro'])
    experience?: string;

    @IsOptional()
    @IsIn(['individual', 'company'])
    entity?: string;

    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'whale'])
    volume?: string;

    @IsOptional()
    @IsIn(['full_time', 'side_income', 'management', 'learning'])
    goal?: string;

    @IsOptional()
    @IsIn(['forex', 'crypto', 'indices', 'synthetic'])
    market?: string;

    @IsOptional()
    @IsIn(['disciplined', 'improving', 'struggling', 'no_plan'])
    discipline?: string;

    @IsOptional()
    @IsIn(['social', 'youtube', 'friend', 'search', 'other'])
    referral?: string;
}

export class OAuthExchangeDto {
    @Transform(trimString)
    @IsString()
    @MinLength(16)
    @MaxLength(256)
    code: string;
}

export class RegisterInitiateDto {
    @Transform(trimString)
    @IsString()
    @MinLength(2, { message: 'Nome deve ter pelo menos 2 caracteres.' })
    @MaxLength(120)
    name: string;

    @Transform(trimLowerEmail)
    @IsEmail({}, { message: 'Informe um e-mail válido.' })
    @MaxLength(254)
    email: string;

    @IsString()
    @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
    @MaxLength(128)
    password: string;

    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    contact: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(4)
    countryIso2?: string;

    @IsOptional()
    @IsIn(['pt', 'en'])
    preferredLocale?: 'pt' | 'en';

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(64)
    timezone?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(120)
    visitorId?: string;

    @IsOptional()
    @IsObject()
    attributionData?: Record<string, unknown>;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(32)
    referralCode?: string;
}

export class VerifyRegistrationDto {
    @Transform(trimString)
    @IsString()
    @MinLength(16)
    @MaxLength(2048)
    verificationToken: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^\d{6}$/, { message: 'O código de verificação deve conter 6 dígitos.' })
    otp: string;
}

export class ResendRegistrationOtpDto {
    @Transform(trimString)
    @IsString()
    @MinLength(16)
    @MaxLength(2048)
    verificationToken: string;
}
