/**
 * YDH 报价转换核心逻辑
 * 从 Python quote_tool.py 移植到 JS/TS
 */

// ======================== 配置 ========================
export const FUEL_RATE = 0.25;

export const HEAVY_WEIGHT_COLS = ['21-30', '31-50', '51-100', '101-300', '301-99999'];

// 旧报价表列名映射
export const OLD_PRICE_COLS = {
  salesman: '业务员',
  customerCode: '客户代码',
  customerName: '客户简称',
  productName: '产品名称',
  firstWeight: '首重0.5kg',
  contWeight: '续重0.5kg',
  fuelRate: '燃油费',
};

// 公开价表结构
export interface PublicPriceEntry {
  weight: number;
  price: number;
}

// 一行原始报价数据（用索引签名避免中文字段问题）
export interface RawQuoteRow {
  [key: string]: any;
}

// 最终报价单行
export interface QuoteRow {
  [key: string]: any;
}

// 折扣明细
export interface DiscountDetail {
  weight: number;
  publicPrice: number;
  oldPrice: number | null;
  newPrice: number;
  requiredDiscount: number;
}

// 21kg+明细
export interface HeavyDetail {
  [key: string]: any;
}

// 转换结果
export interface ConvertResult {
  quoteData: QuoteRow[];
  detailData: any[];
  analysisData: any[];
  heavyData: HeavyDetail[];
  verifyResults: string[];
  totalRecords: number;
  discountCount: number;
  heavyOnlyCount: number;
}

// ======================== 核心函数 ========================

/** 计算旧公式价格 (0-20kg): (首重 + 续重 * (计费重/0.5 - 1)) * (1+燃油费) */
export function calcOldPrice(
  firstWeight: number | null,
  contWeight: number | null,
  weightKg: number,
  fuelRate: number
): number | null {
  if (firstWeight == null || contWeight == null || isNaN(firstWeight) || isNaN(contWeight)) return null;

  const billingWeight = Math.ceil(weightKg * 2) / 2;
  const nHalfKg = Math.round(billingWeight / 0.5);
  const price = (firstWeight + contWeight * (nHalfKg - 1)) * (1 + fuelRate);
  return Math.round(price * 100) / 100;
}

/** 
 * 找到统一折扣率，使所有0-20kg重量段新价 >= 旧价
 * 新公式: 公开价 × 折扣 × 1.25
 */
export function findBestDiscount(
  row: RawQuoteRow,
  publicPrices: Map<number, number>
): { bestDiscount: number | null; details: DiscountDetail[] } {
  const firstW = row['首重0.5kg'];
  const contW = row['续重0.5kg'];
  const fuel = row['燃油费'] ?? 0;

  if (firstW == null || contW == null || isNaN(firstW) || isNaN(contW)) {
    return { bestDiscount: null, details: [] };
  }

  const requiredDiscounts: number[] = [];
  const details: DiscountDetail[] = [];

  for (const [w, pubP] of publicPrices.entries()) {
    if (w > 20) continue;

    const oldP = calcOldPrice(firstW, contW, w, fuel);
    const newP = oldP != null ? Math.round(pubP * 1 * (1 + FUEL_RATE) * 100) / 100 : 0;
    const reqDisc = oldP != null ? oldP / (pubP * (1 + FUEL_RATE)) : 0;

    details.push({
      weight: w,
      publicPrice: pubP,
      oldPrice: oldP,
      newPrice: newP,
      requiredDiscount: Math.round(reqDisc * 10000) / 10000,
    });

    if (oldP != null) {
      requiredDiscounts.push(reqDisc);
    }
  }

  const bestDiscount = requiredDiscounts.length > 0 ? Math.max(...requiredDiscounts) : null;

  return { bestDiscount, details };
}

/** 主转换函数 */
export function convertQuotes(
  rawData: RawQuoteRow[],
  publicPrices: Map<number, number>
): ConvertResult {
  const results: any[] = [];
  const quoteData: QuoteRow[] = [];
  const allAnalysis: any[] = [];
  const heavyData: HeavyDetail[] = [];
  const verifyResults: string[] = [];

  let discountCount = 0;
  let heavyOnlyCount = 0;

  for (const row of rawData) {
    const record: any = {
      业务员: row['业务员'] || '',
      客户代码: row['客户代码'] || '',
      客户简称: row['客户简称'] || '',
      产品名称: row['产品名称'] || '',
      原燃油费: row['燃油费'] ?? '',
    };

    // 最终报价单行
    const quoteRow: QuoteRow = {
      业务员: row['业务员'] || '',
      客户代码: row['客户代码'] || '',
      客户简称: row['客户简称'] || '',
      产品名称: row['产品名称'] || '',
      折扣率: '',
    };

    // 初始化重量段列为空
    for (const w of Array.from(publicPrices.keys()).sort((a, b) => a - b)) {
      if (w <= 20) quoteRow[`${w}kg`] = '';
    }
    for (const col of HEAVY_WEIGHT_COLS) {
      quoteRow[col] = '';
    }

    // ---- 0-20kg 部分 ----
    const { bestDiscount, details } = findBestDiscount(row, publicPrices);

    if (bestDiscount !== null) {
      record['统一折扣率'] = Math.round(bestDiscount * 10000) / 10000;
      record['折扣百分比'] = `${Math.round(bestDiscount * 10000) / 100}%`;
      quoteRow['折扣率'] = `${Math.round(bestDiscount * 10000) / 100}%`;
      discountCount++;

      for (const d of details) {
        const newP = Math.round(d.publicPrice * bestDiscount * (1 + FUEL_RATE) * 100) / 100;
        record[`${d.weight}kg_新价`] = newP;
        quoteRow[`${d.weight}kg`] = newP;

        if (d.oldPrice !== null) {
          record[`${d.weight}kg_旧价`] = d.oldPrice;
          record[`${d.weight}kg_差额`] = Math.round((newP - d.oldPrice) * 100) / 100;

          if (newP < d.oldPrice) {
            verifyResults.push(`FAIL: ${row['客户简称']} | ${row['产品名称']} | ${d.weight}kg 旧=${d.oldPrice} 新=${newP}`);
          }

          allAnalysis.push({
            客户简称: row['客户简称'],
            产品名称: row['产品名称'],
            重量段: `${d.weight}kg`,
            公开价: d.publicPrice,
            旧价: d.oldPrice,
            所需折扣: `${Math.round(d.requiredDiscount * 10000) / 100}%`,
            统一折扣: `${Math.round(bestDiscount * 10000) / 100}%`,
            新价: newP,
            差额: Math.round((newP - d.oldPrice) * 100) / 100,
          });
        }
      }
    } else {
      record['统一折扣率'] = '';
      record['折扣百分比'] = '';
      heavyOnlyCount++;
      for (const w of Array.from(publicPrices.keys()).sort((a, b) => a - b)) {
        if (w <= 20) {
          record[`${w}kg_新价`] = '';
          record[`${w}kg_旧价`] = '';
          record[`${w}kg_差额`] = '';
        }
      }
    }

    // ---- 21kg+ 部分 ----
    for (const col of HEAVY_WEIGHT_COLS) {
      const origVal = row[col];
      if (origVal != null && !isNaN(Number(origVal))) {
        const origNum = Number(origVal);
        const newBasePrice = Math.round((origNum / (1 + FUEL_RATE)) * 100) / 100;

        record[`${col}_原价(含燃油)`] = origNum;
        record[`${col}_新单价(除燃油)`] = newBasePrice;
        quoteRow[col] = newBasePrice;

        heavyData.push({
          客户简称: row['客户简称'] || '',
          产品名称: row['产品名称'] || '',
          weightRange: col,
          originalPrice: Math.round(origNum * 100) / 100,
          newBasePrice: newBasePrice,
          verified: Math.round(newBasePrice * 1.25 * 100) / 100,
        });
      } else {
        record[`${col}_原价(含燃油)`] = '';
        record[`${col}_新单价(除燃油)`] = '';
      }
    }

    results.push(record);
    quoteData.push(quoteRow);
  }

  return {
    quoteData,
    detailData: results,
    analysisData: allAnalysis,
    heavyData,
    verifyResults,
    totalRecords: rawData.length,
    discountCount,
    heavyOnlyCount,
  };
}
