import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends HTTPException {
  constructor(status: ContentfulStatusCode, public readonly code: string, message: string) {
    super(status, { message });
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this resource') => new ApiError(403, 'forbidden', msg);
export const badRequest = (msg: string, code = 'bad_request') => new ApiError(400, code, msg);
export const conflict = (msg: string, code = 'conflict') => new ApiError(409, code, msg);
