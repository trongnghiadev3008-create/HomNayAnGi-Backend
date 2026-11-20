import app from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('✅ Đã kết nối cơ sở dữ liệu qua Prisma ORM.');

    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Server "Hôm Nay Ăn Gì?" đang chạy tại: http://localhost:${env.PORT}`);
      console.log(`📚 Health check: http://localhost:${env.PORT}/api/health`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Nhận tín hiệu ${signal}, đang đóng kết nối an toàn...`);
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ Không thể khởi động server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

bootstrap();
