import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtUserPayload {
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN' | string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

export function signAccessToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Middleware bắt buộc đăng nhập: kiểm tra header Authorization: Bearer <token>
 */
export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Thiếu token xác thực. Vui lòng gửi header Authorization: Bearer <token>.',
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Token xác thực không hợp lệ.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtUserPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Token đã hết hạn hoặc không hợp lệ.',
    });
  }
}

/**
 * Middleware xác thực tùy chọn (dùng cho POST /api/foods/spin):
 * Nếu người dùng gửi kèm Bearer token hợp lệ -> gắn req.user để lưu SpinHistory.
 * Nếu là khách (Guest) không gửi token -> vẫn cho phép quay Gacha bình thường.
 */
export function optionalVerifyToken(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as JwtUserPayload;
        req.user = decoded;
      } catch {
        // Bỏ qua nếu token không hợp lệ ở chế độ optional
      }
    }
  }

  next();
}

/**
 * Middleware phân quyền Admin: chỉ cho phép user.role === "ADMIN"
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Vui lòng đăng nhập để thực hiện thao tác này.',
    });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({
      success: false,
      message: 'Truy cập bị từ chối. Chỉ Quản trị viên (ADMIN) mới có quyền thực hiện.',
    });
    return;
  }

  next();
}
