export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', msg, details);
export const unauthorized = (msg = 'Please sign in to continue.') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You are not allowed to do this.') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'We could not find what you were looking for.') =>
  new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code: string, msg: string, details?: unknown) =>
  new AppError(409, code, msg, details);
