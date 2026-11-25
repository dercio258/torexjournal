import { CallHandler, ExecutionContext, Injectable, NestInterceptor, BadRequestException } from '@nestjs/common';
import { Observable } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB max safety cap

export interface FastifyFileInterceptorOptions {
    dest?: string;
    allowedImageOnly?: boolean;
    maxFileSizeBytes?: number;
}

/**
 * Validates raw file magic bytes to prevent spoofed MIME types or HTML/SVG XSS uploads.
 */
function detectSafeImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
    if (!buffer || buffer.length < 12) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return 'png';
    }
    // GIF87a / GIF89a
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38 &&
        (buffer[4] === 0x37 || buffer[4] === 0x39) &&
        buffer[5] === 0x61
    ) {
        return 'gif';
    }
    // WEBP: "RIFF".... "WEBP"
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'webp';
    }

    return null;
}

@Injectable()
export class FastifyFileInterceptor implements NestInterceptor {
    constructor(
        private readonly fieldName: string,
        private readonly options?: FastifyFileInterceptorOptions,
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        const req = context.switchToHttp().getRequest();

        if (typeof req.isMultipart !== 'function' || !req.isMultipart()) {
            throw new BadRequestException('Request is not multipart');
        }

        const parts = req.parts();
        let filePartObj: any = null;
        req.body = Object.assign(Object.create(null), req.body || {});

        const maxSize = this.options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_BYTES;
        const requireImage = this.options?.allowedImageOnly ?? Boolean(this.options?.dest);

        try {
            for await (const part of parts) {
                if (part.file) {
                    if (part.fieldname === this.fieldName) {
                        const chunks: Buffer[] = [];
                        let totalBytes = 0;
                        for await (const chunk of part.file) {
                            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                            totalBytes += buf.length;
                            if (totalBytes > maxSize) {
                                part.file.resume();
                                throw new BadRequestException(
                                    `Arquivo excede o limite máximo permitido (${Math.round(maxSize / (1024 * 1024))}MB)`,
                                );
                            }
                            chunks.push(buf);
                        }
                        if ((part.file as any).truncated) {
                            throw new BadRequestException(
                                `Arquivo excede o limite máximo permitido (${Math.round(maxSize / (1024 * 1024))}MB)`,
                            );
                        }
                        const buffer = Buffer.concat(chunks, totalBytes);
                        if (buffer.length === 0) {
                            throw new BadRequestException('Arquivo vazio não permitido');
                        }

                        let verifiedExt: string | null = null;
                        if (requireImage) {
                            verifiedExt = detectSafeImageExtension(buffer);
                            if (!verifiedExt) {
                                throw new BadRequestException(
                                    'Formato de imagem inválido ou não permitido. Envie apenas JPG, PNG, WEBP ou GIF válidos.',
                                );
                            }
                        }

                        filePartObj = {
                            fieldname: part.fieldname,
                            originalname: part.filename,
                            encoding: part.encoding,
                            mimetype: verifiedExt
                                ? `image/${verifiedExt === 'jpg' ? 'jpeg' : verifiedExt}`
                                : part.mimetype,
                            buffer,
                            size: buffer.length,
                        };

                        if (this.options?.dest) {
                            const uploadDir = path.resolve(this.options.dest);
                            if (!fs.existsSync(uploadDir)) {
                                fs.mkdirSync(uploadDir, { recursive: true });
                            }
                            const randomName = randomBytes(16).toString('hex');
                            const safeExt = verifiedExt || 'bin';
                            const filename = `${randomName}.${safeExt}`;
                            const filepath = path.join(uploadDir, filename);
                            fs.writeFileSync(filepath, buffer);
                            filePartObj.filename = filename;
                            filePartObj.path = filepath;
                        }
                    } else {
                        part.file.resume();
                    }
                } else {
                    const key = String(part.fieldname || '');
                    if (
                        key &&
                        key !== '__proto__' &&
                        key !== 'constructor' &&
                        key !== 'prototype'
                    ) {
                        req.body[key] = part.value;
                    }
                }
            }
        } catch (err: any) {
            if (err instanceof BadRequestException) {
                throw err;
            }
            throw new BadRequestException(
                'Não foi possível processar o arquivo enviado. Verifique o formato e tente novamente.',
                { cause: err },
            );
        }

        if (!filePartObj) {
            throw new BadRequestException('Nenhum arquivo enviado');
        }

        req.file = filePartObj;
        return next.handle();
    }
}
