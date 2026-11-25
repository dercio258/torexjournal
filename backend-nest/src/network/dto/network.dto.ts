import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength,
} from 'class-validator';

const trimStr = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class MarkLessonWatchedDto {
    @IsOptional()
    @IsBoolean()
    isWatched?: boolean;
}

export class LessonCommentDto {
    @Transform(trimStr)
    @IsString({ message: 'Informe o conteúdo do comentário.' })
    @MinLength(1, { message: 'O comentário não pode estar vazio.' })
    @MaxLength(2000, { message: 'O comentário excede o limite de 2000 caracteres.' })
    content: string;
}

export class PostChannelMessageDto {
    @Transform(trimStr)
    @IsString({ message: 'Informe a mensagem.' })
    @MinLength(1, { message: 'A mensagem não pode estar vazia.' })
    @MaxLength(2000, { message: 'A mensagem excede o limite de 2000 caracteres.' })
    content: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @Matches(/^[a-zA-Z0-9_-]{2,32}$/, { message: 'Sala de chat inválida.' })
    room?: string;
}

export class DirectMessageDto {
    @Transform(trimStr)
    @IsString({ message: 'Informe a mensagem.' })
    @MinLength(1, { message: 'A mensagem não pode estar vazia.' })
    @MaxLength(2000, { message: 'A mensagem excede o limite de 2000 caracteres.' })
    content: string;
}

export class CreateNetworkPostDto {
    @Transform(trimStr)
    @IsString({ message: 'Informe o conteúdo da publicação.' })
    @MinLength(1, { message: 'O conteúdo da publicação não pode estar vazio.' })
    @MaxLength(10000, { message: 'A publicação excede o limite máximo de caracteres.' })
    content: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(40)
    type?: string;

    @IsOptional()
    @IsObject()
    tradeData?: Record<string, unknown>;

    @IsOptional()
    @Transform(trimStr)
    @IsIn(['PUBLIC', 'FOLLOWERS', 'PRIVATE', 'public', 'followers', 'private'])
    visibility?: string;

    @IsOptional()
    @Transform(trimStr)
    @IsString()
    @MaxLength(512)
    imageUrl?: string;
}

export class AddPostCommentDto {
    @Transform(trimStr)
    @IsString({ message: 'Informe o conteúdo do comentário.' })
    @MinLength(1, { message: 'O comentário não pode estar vazio.' })
    @MaxLength(2000, { message: 'O comentário excede o limite de 2000 caracteres.' })
    content: string;
}
