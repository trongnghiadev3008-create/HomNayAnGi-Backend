import { Food } from '@prisma/client';

export interface FormattedFood extends Food {
  restaurant: {
    name: string;
    address: string;
    lat: number;
    lng: number;
  };
}

export const MAIN_MEAL_LABEL = 'Bữa chính';

export function normalizeMainGroup(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return MAIN_MEAL_LABEL;
  const upper = trimmed.toUpperCase();
  if (
    upper === 'ĂN TRƯA' ||
    upper === 'AN TRUA' ||
    upper === 'BỮA CHÍNH' ||
    upper === 'BUA CHINH' ||
    upper === 'LUNCH' ||
    upper === 'MAIN' ||
    upper === 'MAIN_MEAL'
  ) {
    return MAIN_MEAL_LABEL;
  }
  return trimmed;
}

/**
 * Chuẩn hóa dữ liệu Food trả về client:
 * Giữ nguyên toàn bộ trường phẳng chuẩn SQL của Prisma (restaurantName, restaurantAddress, lat, lng)
 * VÀ đính kèm thêm object `restaurant` lồng nhau để tương thích trực tiếp với model Gson trên Android.
 */
export function formatFood(food: Food): FormattedFood {
  return {
    ...food,
    mainGroup: normalizeMainGroup(food.mainGroup),
    restaurant: {
      name: food.restaurantName,
      address: food.restaurantAddress,
      lat: food.lat,
      lng: food.lng,
    },
  };
}

/**
 * Loại bỏ dấu tiếng Việt để hỗ trợ tìm kiếm linh hoạt cả có dấu lẫn không dấu
 * (hoạt động đồng nhất trên cả SQLite và PostgreSQL).
 */
export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}
