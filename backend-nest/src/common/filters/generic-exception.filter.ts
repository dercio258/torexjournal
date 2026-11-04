import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { join } from 'path';
import * as fs from 'fs';

@Catch()
export class GenericExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GenericExceptionFilter.name);
    private readonly clientDist = [
        join(process.cwd(), '..', 'client', 'dist'),
        join(process.cwd(), 'client', 'dist'),
        join(__dirname, '..', '..', '..', '..', 'client', 'dist'),
        join(__dirname, '..', '..', '..', 'client', 'dist'),
    ].find(p => fs.existsSync(p)) || join(process.cwd(), '..', 'client', 'dist');

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<FastifyReply>();
        const request = ctx.getRequest<FastifyRequest>();

        const url = request.raw?.url || request.url || '';
        const cleanPath = url.split('?')[0];

        // SPA Fallback: rotas de navegação GET que não são /api, /uploads ou arquivos estáticos ausentes entregam o index.html
        if (
            exception instanceof NotFoundException &&
            !cleanPath.startsWith('/api') &&
            !cleanPath.startsWith('/uploads') &&
            !/\.[a-zA-Z0-9]+$/.test(cleanPath)
        ) {
            const indexPath = join(this.clientDist, 'index.html');
            if (fs.existsSync(indexPath)) {
                return response.status(HttpStatus.OK).type('text/html').send(fs.createReadStream(indexPath));
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
            this.logger.error('Uncaught Exception details:', exception?.stack || exception);
        }

        response.status(status).send({
            statusCode: status,
            message: message,
            error: error
        });
    }
}
