import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// CurrentUser decorator extracts user from request (JWT strategy attaches it)
export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});