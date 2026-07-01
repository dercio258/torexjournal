import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleOauthGuard extends AuthGuard('google') {
  getRequest(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    return req.raw || req;
  }

  getResponse(context: ExecutionContext) {
    const res = context.switchToHttp().getResponse();
    return res.raw || res;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    const req = context.switchToHttp().getRequest();
    if (req.raw && req.raw.user) {
      req.user = req.raw.user;
    }
    return result;
  }
}
