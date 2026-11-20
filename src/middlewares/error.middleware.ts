import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Không tìm thấy đường dẫn API: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Dữ liệu đầu vào không hợp lệ.',
      errors: err.errors.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  console.error('[API Error]:', err);
  const message = err instanceof Error ? err.message : 'Lỗi máy chủ nội bộ (Internal Server Error).';

  res.status(500).json({
    success: false,
    message,
  });
}
