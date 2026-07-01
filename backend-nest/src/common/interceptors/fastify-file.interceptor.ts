import { CallHandler, ExecutionContext, Injectable, NestInterceptor, BadRequestException } from '@nestjs/common';
import { Observable } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FastifyFileInterceptor implements NestInterceptor {
    constructor(
        private readonly fieldName: string,
        private readonly options?: { dest?: string }
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        const req = context.switchToHttp().getRequest();

        if (typeof req.isMultipart !== 'function' || !req.isMultipart()) {
            throw new BadRequestException('Request is not multipart');
        }

        const parts = req.parts();
        let filePartObj: any = null;
        req.body = req.body || {};

        try {
            for await (const part of parts) {
                if (part.file) {
                    if (part.fieldname === this.fieldName) {
                        const buffer = await part.toBuffer();
                        filePartObj = {
                            fieldname: part.fieldname,
                            originalname: part.filename,
                            encoding: part.encoding,
                            mimetype: part.mimetype,
                            buffer: buffer,
                            size: buffer.length,
                        };

                        if (this.options?.dest) {
                            const uploadDir = path.resolve(this.options.dest);
                            if (!fs.existsSync(uploadDir)) {
                                fs.mkdirSync(uploadDir, { recursive: true });
                            }
                            const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
                            const filename = `${randomName}${path.extname(part.filename)}`;
                            const filepath = path.join(uploadDir, filename);
                            fs.writeFileSync(filepath, buffer);
                            filePartObj.filename = filename;
                            filePartObj.path = filepath;
                        }
                    } else {
                        // Consume other file stream to prevent hanging
                        await part.toBuffer();
                    }
                } else {
                    // Regular fields
                    req.body[part.fieldname] = part.value;
                }
            }
        } catch (err) {
            throw new BadRequestException(`Multipart parsing failed: ${err.message}`);
        }

        // Attach parsed file to request object so `@UploadedFile()` decorator works
        req.file = filePartObj;

        return next.handle();
    }
}
