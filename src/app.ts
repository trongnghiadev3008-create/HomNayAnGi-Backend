import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import foodRoutes from './routes/food.routes';
import userRoutes from './routes/user.routes';
import adminRoutes from './routes/admin.routes';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';

// Đảm bảo JSON.stringify không bao giờ văng lỗi nếu gặp kiểu BigInt (ví dụ timestampMillis)
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

const app = express();

// 1. Bảo mật HTTP Headers bằng Helmet
app.use(helmet());

// 2. Cấu hình CORS cho phép Mobile App / Admin Dashboard kết nối
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 3. Giới hạn tần suất truy cập (Rate Limiting): tối đa 5000 requests / 15 phút mỗi IP
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  limit: 5000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => {
    const clientIp = req.ip || req.socket.remoteAddress || '';
    return (
      LOCALHOST_IPS.has(clientIp) ||
      req.path === '/health' ||
      req.originalUrl.startsWith('/api/health')
    );
  },
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu từ địa chỉ IP này. Vui lòng thử lại sau 15 phút.',
  },
});

app.use('/api', apiLimiter);

// 4. Body Parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 5. Health Check & Welcome Endpoint
app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'Hôm Nay Ăn Gì? RESTful API Server',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      auth: '/api/auth',
      foods: '/api/foods',
      user: '/api/user',
      adminStats: '/api/admin/stats',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: Date.now(),
  });
});

// 6. Đăng ký REST API Routes
app.use('/api/auth', authRoutes);
app.use('/api/foods', foodRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// 7. Xử lý 404 & Error Middleware tập trung
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
