import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin, verifyToken } from '../middlewares/auth.middleware';
import { formatFood } from '../utils/foodMapper';

const router = Router();

/**
 * GET /api/admin/stats
 * Trả về thống kê tổng quan cho Admin:
 * - Tổng số món ăn
 * - Số lượng món theo nhóm chính (mainGroup) & độ hiếm (rarity)
 * - Tổng số người dùng & tổng lượt quay Gacha
 * - Top món ăn được quay trúng nhiều nhất
 */
router.get(
  '/stats',
  verifyToken,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const topLimit = Math.min(Math.max(Number(req.query.top || 10), 1), 50);

      const [
        totalFoods,
        totalUsers,
        totalSpins,
        totalFavorites,
        groupedByMainGroup,
        groupedByRarity,
        topSpunRaw,
      ] = await Promise.all([
        prisma.food.count(),
        prisma.user.count(),
        prisma.spinHistory.count(),
        prisma.favorite.count(),
        prisma.food.groupBy({
          by: ['mainGroup'],
          _count: { id: true },
        }),
        prisma.food.groupBy({
          by: ['rarity'],
          _count: { id: true },
        }),
        prisma.spinHistory.groupBy({
          by: ['foodId'],
          _count: { id: true },
          orderBy: {
            _count: {
              id: 'desc',
            },
          },
          take: topLimit,
        }),
      ]);

      const topFoodIds = topSpunRaw.map((item) => item.foodId);
      const topFoodEntities =
        topFoodIds.length > 0
          ? await prisma.food.findMany({
              where: { id: { in: topFoodIds } },
            })
          : [];

      const foodMap = new Map(topFoodEntities.map((f) => [f.id, f]));

      const topSpunFoods = topSpunRaw
        .map((row) => {
          const food = foodMap.get(row.foodId);
          return food
            ? {
                spinCount: row._count.id,
                food: formatFood(food),
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const byMainGroup = groupedByMainGroup.map((g) => ({
        mainGroup: g.mainGroup,
        count: g._count.id,
      }));

      const byRarity = groupedByRarity.map((r) => ({
        rarity: r.rarity,
        count: r._count.id,
      }));

      res.json({
        success: true,
        stats: {
          totalFoods,
          totalUsers,
          totalSpins,
          totalFavorites,
          byMainGroup,
          byRarity,
          topSpunFoods,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/users
 * Trả về danh sách thực tế toàn bộ người dùng kèm số lượt quay, số món yêu thích và món quay gần nhất
 */
router.get(
  '/users',
  verifyToken,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              favorites: true,
              spinHistory: true,
            },
          },
          spinHistory: {
            take: 1,
            orderBy: { timestampMillis: 'desc' },
            include: { food: true },
          },
        },
      });

      const mappedUsers = users.map((u) => {
        const latestSpin = u.spinHistory[0];
        return {
          id: u.id,
          firebaseUid: u.firebaseUid,
          email: u.email,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
          spinCount: u._count.spinHistory,
          favoritesCount: u._count.favorites,
          lastSpinFood: latestSpin?.food?.name,
          lastSpinAt: latestSpin ? Number(latestSpin.timestampMillis) : null,
        };
      });

      res.json({
        success: true,
        total: mappedUsers.length,
        users: mappedUsers,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
