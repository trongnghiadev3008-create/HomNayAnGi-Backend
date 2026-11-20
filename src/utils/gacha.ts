import { Food } from '@prisma/client';

/**
 * Bảng trọng số tỷ lệ rơi Gacha theo độ hiếm (chuẩn 5 bậc của Hôm Nay Ăn Gì? + alias tiếng Anh)
 * Tổng trọng số 5 bậc chuẩn = 100%
 */
export const RARITY_WEIGHTS: Record<string, number> = {
  'THƯỜNG': 55,
  'HIẾM': 25,
  'SỬ THI': 12,
  'HUYỀN THOẠI': 6,
  'CỔ VẬT': 2,
  // Fallback aliases nếu Admin tạo món bằng tên tiếng Anh
  'COMMON': 55,
  'RARE': 25,
  'EPIC': 12,
  'LEGENDARY': 6,
  'MYTHIC': 2,
  'ARTIFACT': 2,
};

export interface GachaSpinResult {
  winner: Food;
  rolledRarity: string;
  effectiveDropRatePercent: number;
  poolSize: number;
  rarityBreakdown: Array<{
    rarity: string;
    itemCount: number;
    weight: number;
    probabilityPercent: number;
  }>;
}

/**
 * Thuật toán Gacha 2 pha trên Server:
 * - Pha 1: Gom nhóm các món hợp lệ theo `rarity`, chuẩn hóa lại trọng số của các bậc độ hiếm đang có mặt
 *          trong danh sách lọc và quay chọn bậc độ hiếm trúng thưởng theo tỷ lệ Gacha.
 * - Pha 2: Chọn ngẫu nhiên đồng đều (uniform random) 1 món ăn thuộc bậc độ hiếm vừa trúng.
 */
export function spinGachaFood(candidates: Food[]): GachaSpinResult {
  if (candidates.length === 0) {
    throw new Error('Không có món ăn nào phù hợp để quay thưởng.');
  }

  const groupedByRarity = new Map<string, Food[]>();
  for (const food of candidates) {
    const rarityKey = (food.rarity || 'THƯỜNG').toUpperCase().trim();
    const list = groupedByRarity.get(rarityKey) || [];
    list.push(food);
    groupedByRarity.set(rarityKey, list);
  }

  const activeTiers = Array.from(groupedByRarity.entries()).map(([rarity, items]) => ({
    rarity,
    items,
    weight: RARITY_WEIGHTS[rarity] ?? 10,
  }));

  const totalWeight = activeTiers.reduce((sum, tier) => sum + tier.weight, 0);

  // Pha 1: Quay bậc độ hiếm theo trọng số
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  let chosenTier = activeTiers[activeTiers.length - 1];

  for (const tier of activeTiers) {
    cumulative += tier.weight;
    if (roll < cumulative) {
      chosenTier = tier;
      break;
    }
  }

  // Pha 2: Chọn ngẫu nhiên 1 món trong bậc độ hiếm đã trúng
  const randomIndex = Math.floor(Math.random() * chosenTier.items.length);
  const winner = chosenTier.items[randomIndex];

  const rarityBreakdown = activeTiers.map((tier) => ({
    rarity: tier.rarity,
    itemCount: tier.items.length,
    weight: tier.weight,
    probabilityPercent: Number(((tier.weight / totalWeight) * 100).toFixed(2)),
  }));

  const effectiveDropRatePercent = Number(
    ((chosenTier.weight / totalWeight / chosenTier.items.length) * 100).toFixed(4)
  );

  return {
    winner,
    rolledRarity: chosenTier.rarity,
    effectiveDropRatePercent,
    poolSize: candidates.length,
    rarityBreakdown,
  };
}
