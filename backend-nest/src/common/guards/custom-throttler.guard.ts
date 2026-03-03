import { Injectable, ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { TelegrafExecutionContext } from "nestjs-telegraf";

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Check if context is Telegraf
        // nestjs-telegraf usually sets type to 'telegraf' or we can check arguments
        const telegrafContext = TelegrafExecutionContext.create(context);
        const ctx = telegrafContext.getContext();

        // Check if it looks like a Telegraf context (has proper structure)
        // Or simpler: checking if context type is NOT http
        // However, ThrottlerGuard supports WS and GQL too.
        // Telegraf updates usually come as HTTP webhooks or long-polling events (handled internally).

        // Simplest reliable way: check if request/response object exists and looks like HTTP
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();

        // If response object doesn't have header function, it's not Express HTTP response
        // (This is what caused the crash: res.header is not a function)
        if (!res || typeof res.header !== 'function') {
            return true; // Skip throttling for non-HTTP contexts (like Telegraf)
        }

        return super.canActivate(context);
    }
}
