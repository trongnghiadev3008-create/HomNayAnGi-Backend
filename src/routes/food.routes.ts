import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  optionalVerifyToken,
  requireAdmin,
  verifyToken,
} from '../middlewares/auth.middleware';
import {
  formatFood,
  MAIN_MEAL_LABEL,
  normalizeMainGroup,
  normalizeVietnameseText,
} from '../utils/foodMapper';
import { spinGachaFood } from '../utils/gacha';

const router = Router();

const restaurantNestedSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    lat: z.coerce.number().optional(),
    lng: z.coerce.number().optional(),
  })
  .optional();

const createFoodSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, 'Tên món ăn không được để trống'),
  price: z.coerce.number().int().nonnegative('Giá món ăn phải >= 0'),
  mainGroup: z.string().trim().min(1, 'Nhóm chính (mainGroup) là bắt buộc'),
  subCategory: z.string().trim().min(1, 'Danh mục phụ (subCategory) là bắt buộc'),
  rarity: z.string().trim().default('THƯỜNG').transform((v) => v.toUpperCase()),
  isVegetarian: z.coerce.boolean().default(false),
  rating: z.coerce.number().min(0).max(5).default(4.8),
  imageUrl: z.string().trim().default(''),
  description: z.string().trim().default(''),
  restaurantName: z.string().trim().optional(),
  restaurantAddress: z.string().trim().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  restaurant: restaurantNestedSchema,
});

const updateFoodSchema = createFoodSchema.partial().omit({ id: true });

const spinRequestSchema = z.object({
  foodId: z.string().trim().min(1).optional(),
  historyId: z.string().trim().min(1).optional(),
  timestampMillis: z.coerce.number().int().positive().optional(),
  mainGroup: z.string().trim().optional(),
  subCategory: z.string().trim().optional(),
  rarity: z.string().trim().optional(),
  isVegetarian: z.boolean().optional(),
  maxPrice: z.coerce.number().int().positive().optional().nullable(),
  excludeIds: z.array(z.string()).optional(),
});

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).toLowerCase().trim();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
}

/**
 * GET /api/foods
 * Hỗ trợ lọc theo: mainGroup, subCategory, rarity, isVegetarian, maxPrice, search
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mainGroup, subCategory, rarity, isVegetarian, maxPrice, search } = req.query;

    const where: Prisma.FoodWhereInput = {};

    if (typeof mainGroup === 'string' && mainGroup.trim()) {
      const normalizedGroup = normalizeMainGroup(mainGroup);
      where.mainGroup =
        normalizedGroup === MAIN_MEAL_LABEL
          ? { in: [MAIN_MEAL_LABEL, 'Ăn trưa', 'LUNCH', 'MAIN'] }
          : normalizedGroup;
    }

    if (typeof subCategory === 'string' && subCategory.trim()) {
      where.subCategory = subCategory.trim();
    }

    if (typeof rarity === 'string' && rarity.trim()) {
      where.rarity = rarity.trim().toUpperCase();
    }

    const parsedVeg = parseBooleanQuery(isVegetarian);
    if (parsedVeg !== undefined) {
      where.isVegetarian = parsedVeg;
    }

    if (maxPrice !== undefined && maxPrice !== '') {
      const parsedMaxPrice = Number(maxPrice);
      if (!Number.isNaN(parsedMaxPrice) && parsedMaxPrice >= 0) {
        where.price = { lte: Math.floor(parsedMaxPrice) };
      }
    }

    let foods = await prisma.food.findMany({
      where,
      orderBy: { id: 'asc' },
    });

    // Hỗ trợ tìm kiếm tiếng Việt cả có dấu và không dấu (đồng nhất trên SQLite & PostgreSQL)
    if (typeof search === 'string' && search.trim()) {
      const keyword = normalizeVietnameseText(search);
      foods = foods.filter((food) => {
        const searchable = normalizeVietnameseText(
          `${food.name} ${food.subCategory} ${food.mainGroup} ${food.description} ${food.restaurantName} ${food.restaurantAddress}`
        );
        return searchable.includes(keyword);
      });
    }

    res.json({
      success: true,
      total: foods.length,
      data: foods.map(formatFood),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/foods/spin
 * - Nếu Android truyền sẵn `foodId` trong body -> ghi nhận đúng món `foodId` vừa quay vào `SpinHistory` của user đó.
 * - Nếu không truyền `foodId` -> quay ngẫu nhiên Gacha theo tỷ lệ độ hiếm trên Server.
 * Nếu người dùng đã đăng nhập (có Bearer JWT hợp lệ) -> tự động lưu vào SpinHistory.
 */
router.post(
  '/spin',
  optionalVerifyToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = spinRequestSchema.parse({
        ...req.query,
        ...req.body,
        isVegetarian:
          req.body?.isVegetarian !== undefined
            ? Boolean(req.body.isVegetarian)
            : parseBooleanQuery(req.query.isVegetarian),
      });

      let winnerFood = filters.foodId
        ? await prisma.food.findUnique({ where: { id: filters.foodId } })
        : null;

      let rolledRarity = winnerFood?.rarity ?? 'THƯỜNG';
      let effectiveDropRatePercent = 100;
      let poolSize = 1;
      let rarityBreakdown: Array<{
        rarity: string;
        itemCount: number;
        weight: number;
        probabilityPercent: number;
      }> = winnerFood
        ? [
            {
              rarity: winnerFood.rarity,
              itemCount: 1,
              weight: 100,
              probabilityPercent: 100,
            },
          ]
        : [];

      if (!winnerFood) {
        const where: Prisma.FoodWhereInput = {};

        if (filters.mainGroup) {
          const normalizedGroup = normalizeMainGroup(filters.mainGroup);
          where.mainGroup =
            normalizedGroup === MAIN_MEAL_LABEL
              ? { in: [MAIN_MEAL_LABEL, 'Ăn trưa', 'LUNCH', 'MAIN'] }
              : normalizedGroup;
        }
        if (filters.subCategory) {
          where.subCategory = filters.subCategory;
        }
        if (filters.rarity) {
          where.rarity = filters.rarity.toUpperCase();
        }
        if (filters.isVegetarian !== undefined) {
          where.isVegetarian = filters.isVegetarian;
        }
        if (filters.maxPrice !== undefined && filters.maxPrice !== null) {
          where.price = { lte: filters.maxPrice };
        }
        if (filters.excludeIds && filters.excludeIds.length > 0) {
          where.id = { notIn: filters.excludeIds };
        }

        const candidates = await prisma.food.findMany({ where });

        if (candidates.length === 0) {
          res.status(404).json({
            success: false,
            message: 'Không tìm thấy món ăn nào phù hợp với bộ lọc hiện tại để quay thưởng.',
          });
          return;
        }

        const gachaResult = spinGachaFood(candidates);
        winnerFood = gachaResult.winner;
        rolledRarity = gachaResult.rolledRarity;
        effectiveDropRatePercent = gachaResult.effectiveDropRatePercent;
        poolSize = gachaResult.poolSize;
        rarityBreakdown = gachaResult.rarityBreakdown;
      }

      const formattedWinner = formatFood(winnerFood);

      // Nếu đã đăng nhập -> kiểm tra user tồn tại rồi lưu vào SpinHistory với đúng foodId & userId
      let savedHistory: {
        id: string;
        foodId: string;
        timestampMillis: number;
      } | null = null;

      if (req.user?.userId) {
        const existingUser = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { id: true },
        });

        if (existingUser) {
          const eventMillis = BigInt(filters.timestampMillis || Date.now());
          const deterministicId = filters.historyId
            ? `${existingUser.id}_${filters.historyId}`
            : undefined;

          const createdHistory = deterministicId
            ? await prisma.spinHistory.upsert({
                where: { id: deterministicId },
                update: {},
                create: {
                  id: deterministicId,
                  userId: existingUser.id,
                  foodId: winnerFood.id,
                  timestampMillis: eventMillis,
                },
              })
            : await prisma.spinHistory.create({
                data: {
                  userId: existingUser.id,
                  foodId: winnerFood.id,
                  timestampMillis: eventMillis,
                },
              });

          savedHistory = {
            id: createdHistory.id,
            foodId: createdHistory.foodId,
            timestampMillis: Number(createdHistory.timestampMillis),
          };
        }
      }

      res.json({
        success: true,
        message: `Chúc mừng! Bạn đã quay trúng món "${winnerFood.name}" (${rolledRarity})!`,
        food: formattedWinner,
        gacha: {
          rolledRarity,
          effectiveDropRatePercent,
          poolSize,
          rarityBreakdown,
        },
        history: savedHistory,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/foods/:id
 * Lấy chi tiết 1 món ăn theo ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const food = await prisma.food.findUnique({
      where: { id: req.params.id },
    });

    if (!food) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy món ăn.',
      });
      return;
    }

    res.json({
      success: true,
      data: formatFood(food),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/foods (Admin only)
 * Thêm món ăn mới
 */
router.post(
  '/',
  verifyToken,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = createFoodSchema.parse(req.body);
      const id = payload.id || `food_${crypto.randomUUID().slice(0, 8)}`;

      const existing = await prisma.food.findUnique({ where: { id } });
      if (existing) {
        res.status(409).json({
          success: false,
          message: `Món ăn với ID "${id}" đã tồn tại.`,
        });
        return;
      }

      const created = await prisma.food.create({
        data: {
          id,
          name: payload.name,
          price: payload.price,
          mainGroup: normalizeMainGroup(payload.mainGroup),
          subCategory: payload.subCategory,
          rarity: payload.rarity,
          isVegetarian: payload.isVegetarian,
          rating: payload.rating,
          imageUrl: payload.imageUrl,
          description: payload.description,
          restaurantName:
            payload.restaurantName ?? payload.restaurant?.name ?? 'Quán Ngon Sài Gòn',
          restaurantAddress:
            payload.restaurantAddress ?? payload.restaurant?.address ?? 'TP. Hồ Chí Minh',
          lat: payload.lat ?? payload.restaurant?.lat ?? 10.7769,
          lng: payload.lng ?? payload.restaurant?.lng ?? 106.7009,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Thêm món ăn mới thành công.',
        data: formatFood(created),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/foods/:id (Admin only)
 * Cập nhật thông tin món ăn
 */
router.put(
  '/:id',
  verifyToken,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const foodId = req.params.id;
      const existing = await prisma.food.findUnique({ where: { id: foodId } });

      if (!existing) {
        res.status(404).json({
          success: false,
          message: 'Không tìm thấy món ăn cần cập nhật.',
        });
        return;
      }

      const payload = updateFoodSchema.parse(req.body);

      const updated = await prisma.food.update({
        where: { id: foodId },
        data: {
          ...(payload.name !== undefined && { name: payload.name }),
          ...(payload.price !== undefined && { price: payload.price }),
          ...(payload.mainGroup !== undefined && {
            mainGroup: normalizeMainGroup(payload.mainGroup),
          }),
          ...(payload.subCategory !== undefined && { subCategory: payload.subCategory }),
          ...(payload.rarity !== undefined && { rarity: payload.rarity }),
          ...(payload.isVegetarian !== undefined && { isVegetarian: payload.isVegetarian }),
          ...(payload.rating !== undefined && { rating: payload.rating }),
          ...(payload.imageUrl !== undefined && { imageUrl: payload.imageUrl }),
          ...(payload.description !== undefined && { description: payload.description }),
          ...((payload.restaurantName !== undefined || payload.restaurant?.name !== undefined) && {
            restaurantName: payload.restaurantName ?? payload.restaurant?.name,
          }),
          ...((payload.restaurantAddress !== undefined ||
            payload.restaurant?.address !== undefined) && {
            restaurantAddress: payload.restaurantAddress ?? payload.restaurant?.address,
          }),
          ...((payload.lat !== undefined || payload.restaurant?.lat !== undefined) && {
            lat: payload.lat ?? payload.restaurant?.lat,
          }),
          ...((payload.lng !== undefined || payload.restaurant?.lng !== undefined) && {
            lng: payload.lng ?? payload.restaurant?.lng,
          }),
        },
      });

      res.json({
        success: true,
        message: 'Cập nhật món ăn thành công.',
        data: formatFood(updated),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/foods/:id (Admin only)
 * Xóa món ăn khỏi hệ thống
 */
router.delete(
  '/:id',
  verifyToken,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const foodId = req.params.id;
      const existing = await prisma.food.findUnique({ where: { id: foodId } });

      if (!existing) {
        res.status(404).json({
          success: false,
          message: 'Không tìm thấy món ăn cần xóa.',
        });
        return;
      }

      await prisma.food.delete({ where: { id: foodId } });

      res.json({
        success: true,
        message: `Đã xóa món ăn "${existing.name}" (${foodId}) thành công.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
