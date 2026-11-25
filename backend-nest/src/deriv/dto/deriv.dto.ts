import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConnectDerivDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString({ message: 'Informe um token de API válido.' })
    @MinLength(8, { message: 'Token de API inválido ou muito curto.' })
    @MaxLength(256, { message: 'Token de API excede o tamanho máximo permitido.' })
    token: string;
}
