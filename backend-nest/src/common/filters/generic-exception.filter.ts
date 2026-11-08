import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { join, resolve, extname, basename } from 'path';
import * as fs from 'fs';

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
};

@Catch()
export class GenericExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GenericExceptionFilter.name);
    private readonly clientDist = [
        join(process.cwd(), '..', 'client', 'dist'),
        join(process.cwd(), 'client', 'dist'),
        join(__dirname, '..', '..', '..', '..', 'client', 'dist'),
        join(__dirname, '..', '..', '..', 'client', 'dist'),
    ].find(p => fs.existsSync(p)) || join(process.cwd(), '..', 'client', 'dist');

    private findFallbackBundle(cleanPath: string): string | null {
        try {
            // Se o navegador/Cloudflare pedir um hash antigo de index-*.js ou index-*.css após novo build,
            // entrega o bundle atual do disco com no-store para evitar tela branca
            const assetMatch = cleanPath.match(/^\/assets\/(index|workbox-window\.prod\.es5)-[a-zA-Z0-9_-]+\.(js|css)$/);
            if (assetMatch) {
                const [, prefix, ext] = assetMatch;
                const assetsDir = join(this.clientDist, 'assets');
                if (fs.existsSync(assetsDir)) {
                    const files = fs.readdirSync(assetsDir);
                    const replacement = files.find(f => f.startsWith(`${prefix}-`) && f.endsWith(`.${ext}`));
                    if (replacement) {
                        return join(assetsDir, replacement);
                    }
                }
            }

            // Fallback para workbox-*.js na raiz do client/dist
            const workboxRootMatch = cleanPath.match(/^\/(workbox-[a-zA-Z0-9_-]+\.js)$/);
            if (workboxRootMatch && fs.existsSync(this.clientDist)) {
                const files = fs.readdirSync(this.clientDist);
                const replacement = files.find(f => /^workbox-[a-zA-Z0-9_-]+\.js$/.test(f));
                if (replacement) {
                    return join(this.clientDist, replacement);
                }
            }
        } catch (err) {
            this.logger.warn(`Fallback bundle lookup error: ${err?.message || err}`);
        }
        return null;
    }

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<FastifyReply>();
        const request = ctx.getRequest<FastifyRequest>();

        const url = request.raw?.url || request.url || '';
        const cleanPath = decodeURIComponent(url.split('?')[0]);

        if (
            exception instanceof NotFoundException &&
            !cleanPath.startsWith('/api') &&
            !cleanPath.startsWith('/uploads')
        ) {
            const resolvedDist = resolve(this.clientDist);
            const candidateFile = resolve(this.clientDist, '.' + cleanPath);

            // 1. Se o arquivo estático existe no disco (mesmo gerado após o boot do NestJS), serve diretamente
            if (
                candidateFile.startsWith(resolvedDist) &&
                fs.existsSync(candidateFile) &&
                fs.statSync(candidateFile).isFile()
            ) {
                const ext = extname(candidateFile).toLowerCase();
                const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
                const fileName = basename(candidateFile);
                const isMutableEntry =
                    ext === '.html' ||
                    ext === '.webmanifest' ||
                    fileName === 'sw.js' ||
                    fileName === 'registerSW.js' ||
                    /^workbox-[a-zA-Z0-9_-]+\.js$/.test(fileName);

                response.header(
                    'Cache-Control',
                    isMutableEntry
                        ? 'no-cache, no-store, must-revalidate'
                        : 'public, max-age=31536000, immutable'
                );
                return response.status(HttpStatus.OK).type(mimeType).send(fs.createReadStream(candidateFile));
            }

            // 2. Se pediu um hash antigo de /assets/index-*.js ou /assets/index-*.css, serve o bundle atual sem cachear o nome antigo
            const fallbackBundle = this.findFallbackBundle(cleanPath);
            if (fallbackBundle && fs.existsSync(fallbackBundle)) {
                const ext = extname(fallbackBundle).toLowerCase();
                const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
                response.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                return response.status(HttpStatus.OK).type(mimeType).send(fs.createReadStream(fallbackBundle));
            }

            // 3. SPA Fallback: rotas de navegação GET sem extensão entregam o index.html
            if (!/\.[a-zA-Z0-9]+$/.test(cleanPath)) {
                const indexPath = join(this.clientDist, 'index.html');
                if (fs.existsSync(indexPath)) {
                    response.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                    response.header('Pragma', 'no-cache');
                    response.header('Expires', '0');
                    return response.status(HttpStatus.OK).type('text/html; charset=utf-8').send(fs.createReadStream(indexPath));
                }
            }
        }

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Ocorreu um erro interno no servidor. Por favor, tente novamente mais tarde.';
        let error = 'Internal Server Error';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const resObj: any = exception.getResponse();
            if (typeof resObj === 'string') {
                message = resObj;
            } else if (typeof resObj === 'object' && resObj !== null) {
                message = Array.isArray(resObj.message) ? resObj.message[0] : (resObj.message || message);
                error = resObj.error || error;
            }
        } else {
            // Log non-HTTP exceptions (like database errors or system crashes) internally
            this.logger.error(`Uncaught Exception on ${cleanPath}:`, exception?.stack || exception);
            if (cleanPath.includes('/mt5-worker/')) {
                message = exception?.message || message;
            }
        }

        // Impede que CDNs (como Cloudflare) façam cache de respostas 404/500
        response.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        response.status(status).send({
            statusCode: status,
            message: message,
            error: error
        });
    }
}

