import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../middlewares/auth.middleware';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
  name: z.string().min(1, 'Tên hiển thị không được để trống').trim(),
});

const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

const firebaseSyncSchema = z
  .object({
    firebaseUid: z.string().trim().optional(),
    uid: z.string().trim().optional(),
    email: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z
        .string()
        .email('Email không hợp lệ')
        .optional()
        .nullable()
        .transform((v) => (v ? v.toLowerCase().trim() : null))
    ),
    name: z.string().optional().nullable(),
    displayName: z.string().optional().nullable(),
  })
  .refine((data) => Boolean(data.firebaseUid || data.uid), {
    message: 'firebaseUid là bắt buộc',
    path: ['firebaseUid'],
  });

function sanitizeUser(user: {
  id: string;
  firebaseUid: string | null;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/**
 * POST /api/auth/register
 * Đăng ký tài khoản mới bằng Email & Mật khẩu
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'Email này đã được sử dụng.',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: 'USER',
      },
    });

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công.',
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Đăng nhập bằng Email & Mật khẩu
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác.',
      });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác.',
      });
      return;
    }

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      success: true,
      message: 'Đăng nhập thành công.',
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/firebase-sync
 * Đồng bộ thông tin người dùng từ Firebase Auth (Android) và cấp JWT Token của Backend
 */
router.post('/firebase-sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = firebaseSyncSchema.parse(req.body);
    const firebaseUid = (parsed.firebaseUid || parsed.uid || '').trim();
    const email = parsed.email ?? null;
    const name = parsed.name?.trim() || parsed.displayName?.trim() || null;

    const effectiveEmail = email || `${firebaseUid}@firebase.homnayangi.local`;
    const fallbackName =
      name ||
      (email ? email.split('@')[0] : 'Hội Viên Ẩm Thực');

    // 1. Tìm theo firebaseUid trước
    let user = await prisma.user.findUnique({
      where: { firebaseUid },
    });

    // 2. Nếu chưa liên kết firebaseUid nhưng đã có tài khoản cùng email -> liên kết firebaseUid
    if (!user) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: effectiveEmail },
      });

      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            firebaseUid,
            name: name?.trim() || existingByEmail.name,
          },
        });
      }
    } else if (name?.trim() && user.name !== name.trim()) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: name.trim() },
      });
    }

    // 3. Nếu hoàn toàn mới -> tạo mới User với mật khẩu ngẫu nhiên được băm an toàn
    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      user = await prisma.user.create({
        data: {
          firebaseUid,
          email: effectiveEmail,
          passwordHash,
          name: fallbackName,
          role: 'USER',
        },
      });
    }

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      success: true,
      message: 'Đồng bộ tài khoản Firebase thành công.',
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
