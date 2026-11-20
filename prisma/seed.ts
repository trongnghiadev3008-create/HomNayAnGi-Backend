import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

interface RawRestaurant {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

interface RawFoodItem {
  id: string;
  name: string;
  price: number;
  mainGroup: string;
  subCategory: string;
  rarity: string;
  isVegetarian?: boolean;
  rating?: number;
  imageUrl?: string;
  description?: string;
  restaurantName?: string;
  restaurantAddress?: string;
  lat?: number;
  lng?: number;
  restaurant?: RawRestaurant;
}

function resolveFoodsJsonPath(): string {
  const candidates = [
    path.resolve(__dirname, '../foods.json'),
    path.resolve(__dirname, './foods.json'),
    path.resolve(process.cwd(), 'foods.json'),
    path.resolve(process.cwd(), 'prisma/foods.json'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  throw new Error(
    `Không tìm thấy file foods.json. Đã kiểm tra tại: ${candidates.join(', ')}`
  );
}

async function main() {
  console.log('🌱 Bắt đầu khởi tạo dữ liệu (Seed Database)...');

  // 1. Tạo tài khoản Admin mặc định
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@homnayangi.vn').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      passwordHash,
      name: 'Quản Trị Viên Hôm Nay Ăn Gì',
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Quản Trị Viên Hôm Nay Ăn Gì',
      role: 'ADMIN',
    },
  });

  console.log(`✅ Đã khởi tạo tài khoản Admin: ${adminUser.email} (Mật khẩu mặc định: ${adminPassword})`);

  // 2. Đọc file foods.json (365 món ăn) và nạp vào Database
  const foodsJsonPath = resolveFoodsJsonPath();
  const rawContent = fs.readFileSync(foodsJsonPath, 'utf-8');
  const rawFoods: RawFoodItem[] = JSON.parse(rawContent);

  console.log(`📦 Đọc thành công ${rawFoods.length} món ăn từ ${foodsJsonPath}`);

  const normalizeMainGroup = (raw?: string) => {
    const t = (raw || '').trim();
    if (!t) return 'Bữa chính';
    const u = t.toUpperCase();
    if (u === 'ĂN TRƯA' || u === 'AN TRUA' || u === 'LUNCH' || u === 'MAIN') {
      return 'Bữa chính';
    }
    return t;
  };

  // Dùng transaction batch để seed nhanh & an toàn trên cả SQLite và PostgreSQL
  const mappedFoods = rawFoods.map((item, idx) => ({
    id: item.id || `food_${String(idx + 1).padStart(3, '0')}`,
    name: item.name,
    price: Number(item.price) || 0,
    mainGroup: normalizeMainGroup(item.mainGroup),
    subCategory: item.subCategory || 'Khác',
    rarity: (item.rarity || 'THƯỜNG').toUpperCase().trim(),
    isVegetarian: Boolean(item.isVegetarian),
    rating: Number(item.rating ?? 4.8),
    imageUrl: item.imageUrl || '',
    description: item.description || '',
    restaurantName: item.restaurantName ?? item.restaurant?.name ?? 'Quán Ngon Sài Gòn',
    restaurantAddress: item.restaurantAddress ?? item.restaurant?.address ?? 'TP. Hồ Chí Minh',
    lat: Number(item.lat ?? item.restaurant?.lat ?? 10.7769),
    lng: Number(item.lng ?? item.restaurant?.lng ?? 106.7009),
  }));

  const chunkSize = 50;
  let upsertedCount = 0;

  for (let i = 0; i < mappedFoods.length; i += chunkSize) {
    const chunk = mappedFoods.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((food) =>
        prisma.food.upsert({
          where: { id: food.id },
          update: food,
          create: food,
        })
      )
    );
    upsertedCount += chunk.length;
  }

  const totalFoodsInDb = await prisma.food.count();
  console.log(`🎉 Hoàn tất nạp ${upsertedCount} món ăn! Tổng số món trong Database hiện tại: ${totalFoodsInDb}`);
}

main()
  .catch((error) => {
    console.error('❌ Lỗi khi seed dữ liệu:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
