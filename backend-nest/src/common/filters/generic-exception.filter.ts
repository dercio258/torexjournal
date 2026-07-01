import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class GenericExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GenericExceptionFilter.name);

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<FastifyReply>();

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
