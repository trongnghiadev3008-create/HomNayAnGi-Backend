import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../middlewares/auth.middleware';
import { formatFood } from '../utils/foodMapper';

const router = Router();

// Tất cả các endpoint /api/user đều yêu cầu xác thực JWT
router.use(verifyToken);

/**
 * GET /api/user/profile
 * Lấy thông tin hồ sơ người dùng kèm danh sách món yêu thích và thống kê lượt quay
 */
router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        favorites: {
          include: { food: true },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            favorites: true,
            spinHistory: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài khoản người dùng.',
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        stats: {
          favoritesCount: user._count.favorites,
          spinCount: user._count.spinHistory,
        },
        favoriteIds: user.favorites.map((fav) => fav.foodId),
        favorites: user.favorites.map((fav) => formatFood(fav.food)),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/favorites
 * Lấy danh sách các món ăn yêu thích của người dùng
 */
router.get('/favorites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: { food: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      total: favorites.length,
      favoriteIds: favorites.map((item) => item.foodId),
      data: favorites.map((item) => formatFood(item.food)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/favorites/:foodId
 * Toggle yêu thích món ăn (nếu đã thích -> bỏ thích, chưa thích -> thêm vào yêu thích)
 */
router.post('/favorites/:foodId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { foodId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Tài khoản người dùng không tồn tại.',
      });
      return;
    }

    const food = await prisma.food.findUnique({
      where: { id: foodId },
    });
    if (!food) {
      res.status(404).json({
        success: false,
        message: `Không tìm thấy món ăn với ID "${foodId}".`,
      });
      return;
    }

    const existingFavorite = await prisma.favorite.findUnique({
      where: {
        userId_foodId: {
          userId,
          foodId,
        },
      },
    });

    const desiredState =
      typeof req.body?.isFavorite === 'boolean' ? req.body.isFavorite : undefined;

    let isFavorite: boolean;
    if (desiredState === true) {
      if (!existingFavorite) {
        await prisma.favorite.create({
          data: {
            userId,
            foodId,
          },
        });
      }
      isFavorite = true;
    } else if (desiredState === false) {
      if (existingFavorite) {
        await prisma.favorite.delete({
          where: {
            userId_foodId: {
              userId,
              foodId,
            },
          },
        });
      }
      isFavorite = false;
    } else if (existingFavorite) {
      await prisma.favorite.delete({
        where: {
          userId_foodId: {
            userId,
            foodId,
          },
        },
      });
      isFavorite = false;
    } else {
      await prisma.favorite.create({
        data: {
          userId,
          foodId,
        },
      });
      isFavorite = true;
    }

    const allFavorites = await prisma.favorite.findMany({
      where: { userId },
      select: { foodId: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      message: isFavorite
        ? `Đã thêm "${food.name}" vào danh sách yêu thích.`
        : `Đã xóa "${food.name}" khỏi danh sách yêu thích.`,
      isFavorite,
      foodId,
      favoriteIds: allFavorites.map((f) => f.foodId),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/sync-state
 * Đồng bộ hàng loạt danh sách món yêu thích và lịch sử quay từ Android App lên Backend
 * (Idempotent - không tạo trùng lặp khi mở lại ứng dụng nhiều lần)
 */
router.post('/sync-state', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const rawFavIds: string[] = Array.isArray(req.body?.favoriteIds)
      ? req.body.favoriteIds.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];

    const rawHistory: Array<{ id?: string; foodId?: string; timestampMillis?: number }> = Array.isArray(
      req.body?.spinHistory
    )
      ? req.body.spinHistory
      : [];

    const validFoods = await prisma.food.findMany({
      select: { id: true },
    });
    const validFoodIdSet = new Set(validFoods.map((f) => f.id));

    // 1. Sync favorites idempotently
    for (const foodId of rawFavIds) {
      if (!validFoodIdSet.has(foodId)) continue;
      await prisma.favorite.upsert({
        where: {
          userId_foodId: {
            userId,
            foodId,
          },
        },
        update: {},
        create: {
          userId,
          foodId,
        },
      });
    }

    // 2. Sync spinHistory idempotently
    for (const item of rawHistory) {
      const foodId = typeof item.foodId === 'string' ? item.foodId.trim() : '';
      if (!foodId || !validFoodIdSet.has(foodId)) continue;

      const tsMillis =
        typeof item.timestampMillis === 'number' && Number.isFinite(item.timestampMillis) && item.timestampMillis > 0
          ? BigInt(Math.floor(item.timestampMillis))
          : BigInt(Date.now());

      const clientItemId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
      if (clientItemId) {
        const deterministicId = `${userId}_${clientItemId}`;
        await prisma.spinHistory.upsert({
          where: { id: deterministicId },
          update: {},
          create: {
            id: deterministicId,
            userId,
            foodId,
            timestampMillis: tsMillis,
          },
        });
      } else {
        await prisma.spinHistory.create({
          data: {
            userId,
            foodId,
            timestampMillis: tsMillis,
          },
        });
      }
    }

    const [allFavorites, totalSpins] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId },
        select: { foodId: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.spinHistory.count({ where: { userId } }),
    ]);

    res.json({
      success: true,
      message: 'Đồng bộ dữ liệu yêu thích và lịch sử quay thành công.',
      favoriteIds: allFavorites.map((f) => f.foodId),
      spinCount: totalSpins,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/history
 * Lấy lịch sử quay thưởng Gacha (Admin xem được nhật ký toàn hệ thống, User xem lịch sử của mình)
 */
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN' && req.query.scope !== 'mine';
    const limitParam = Number(req.query.limit || 100);
    const take = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;

    const historyItems = await prisma.spinHistory.findMany({
      where: isAdmin ? {} : { userId },
      include: { food: true },
      orderBy: { timestampMillis: 'desc' },
      take,
    });

    res.json({
      success: true,
      total: historyItems.length,
      data: historyItems.map((item) => ({
        id: item.id,
        userId: item.userId,
        foodId: item.foodId,
        timestampMillis: Number(item.timestampMillis),
        food: formatFood(item.food),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/user/account
 * Xóa vĩnh viễn tài khoản và toàn bộ dữ liệu cá nhân (Favorites + SpinHistory + User)
 * Tuân thủ chính sách Data Safety & Account Deletion của Google Play (CH Play).
 */
router.delete('/account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: 'Tài khoản không tồn tại hoặc đã bị xóa trước đó.',
      });
      return;
    }

    await prisma.$transaction([
      prisma.favorite.deleteMany({ where: { userId } }),
      prisma.spinHistory.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    res.json({
      success: true,
      message: 'Tài khoản và toàn bộ dữ liệu cá nhân của bạn đã được xóa vĩnh viễn.',
      deletedUserId: userId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
