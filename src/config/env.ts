import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT || 4000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
  JWT_SECRET: process.env.JWT_SECRET || 'hom-nay-an-gi-jwt-secret-key-2026-secure',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
};
