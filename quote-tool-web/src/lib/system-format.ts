/**
 * 公司系统导入格式转换器
 * 把"最终报价单"转换为公司系统导入模板（每行一个重量段）
 */

// 系统重量段区间（7档）
export const SYSTEM_WEIGHT_RANGES = [
  '0-3', '3-20', '20-30', '30-50', '50-100', '100-300', '300-9999',
] as const;

// 重量段 → 原表列名映射（匹配"最终报价单"的实际列名）
// SheetJS 读取时会截断括号，所以只保留前缀
const RANGE_COL_CANDIDATES: Record<string, string[]> = {
  '0-3':   ['3.0kg_新价'],
  '3-20':  ['20.0kg_新价'],
  '20-30': ['21-30', '21-30_新单价', '21-30kg_新单价'],
  '30-50': ['31-50', '31-50_新单价', '31-50kg_新单价'],
  '50-100': ['51-100', '51-100_新单价', '51-100kg_新单价'],
  '100-300':['101-300','101-300_新单价','101-300kg_新单价'],
  '300-9999':['301-99999','301-99999_新单价','301-99999kg_新单价'],
};

/** 从行数据中查找价格值，依次尝试候选列名 */
function findPrice(row: any, candidates: string[]): number | string {
  // 精确匹配
  for (const col of candidates) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      const p = Number(row[col]);
      if (!isNaN(p)) return p;
    }
  }
  // 模糊匹配
  const keys = Object.keys(row);
  for (const col of candidates) {
    const keyword = col.split('_')[0];
    const found = keys.find(k => k.includes(keyword) && k.includes('新'));
    if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
      const p = Number(row[found]);
      if (!isNaN(p)) return p;
    }
  }
  return '';
}

// 产品名称 → 产品代码映射（支持多种写法）
const PRODUCT_CODE_MAP: Record<string, string> = {
  // 完整名称
  '日本商业件经济 (JPSYJE)':           'JPSYJE',
  '日本商业件 (SYJ)':                  'SYJ',
  '商业件超级经济 (JPSYJESE)':         'JPSYJESE',
  '东京特快+限时达商业 (JPSYTK)':       'JPSYTK',
  '东京特快+限时达商业(JPSYTK-K)':     'JPSYTK-K',
  '日本商业件(青岛大连) (SYJ-D)':       'SYJ-D',
  '日本商业件特快(青岛大连) (SYJV-QD)': 'SYJV-QD',
  // 简称（匹配文件中实际使用的名称）
  '日本商业件经济':                     'JPSYJE',
  '日本商业件':                        'SYJ',
  '商业件超级经济':                    'JPSYJESE',
  '东京特快+限时达商业':                'JPSYTK',
  '东京特快+限时达商业(JPSYTK-K)':     'JPSYTK-K',
  '日本商业件(青岛大连)':              'SYJ-D',
  '日本商业件特快(青岛大连)':          'SYJV-QD',
};

// 输出列定义
export const OUTPUT_HEADERS = [
  '客户代码', '产品代码', '计费地', '货物类型', '模板类型', '模板名称',
  '币别', '生效时间', '分区名称', '重量段标题', '运费金额', '特殊处理费',
  '首重费用', '续重费用', '折扣',
];

export interface SystemFormatRow {
  客户代码: string;
  产品代码: string;
  计费地: string;
  货物类型: string;
  模板类型: string;
  模板名称: string;
  币别: string;
  生效时间: string;
  分区名称: string;
  重量段标题: string;
  运费金额: number | string;
  特殊处理费: string;
  首重费用: number | string;
  续重费用: number | string;
  折扣: number | string;
}

export interface SystemFormatResult {
  rows: SystemFormatRow[];
  totalRecords: number;
  customerCount: number;
}

/**
 * 转换主函数
 * @param rawData - 最终报价表的原始行数据（从 SheetJS 解析的 JSON 数组）
 * @param options - 可选配置
 */
export function convertToSystemFormat(
  rawData: any[],
  options?: {
    effectiveDate?: string;   // 默认当天
    templateNamePrefix?: string; // 默认用产品代码
  }
): SystemFormatResult {
  const effectiveDate = options?.effectiveDate || formatDate(new Date());
  const rows: SystemFormatRow[] = [];
  const customerSet = new Set<string>();

  for (const row of rawData) {
    // 提取客户代码
    const customerCode = String(row['客户代码'] || '').trim();
    if (!customerCode) continue;

    // 提取产品名称并映射为产品代码
    const productName = String(row['产品名称'] || '').trim();
    const productCode = PRODUCT_CODE_MAP[productName];
    if (!productCode) {
      console.warn(`未知产品名称: ${productName}, 跳过`);
      continue;
    }

    // 提取折扣率（百分比转小数，如 "19.53%" → 0.1953）
    let discountVal: number | string = '';
    const rawDiscount = row['折扣率'] || row['折扣百分比'] || row['统一折扣率'];
    if (rawDiscount !== undefined && rawDiscount !== null && rawDiscount !== '') {
      if (typeof rawDiscount === 'string') {
        const num = parseFloat(rawDiscount.replace('%', ''));
        if (!isNaN(num)) discountVal = num / 100;
      } else if (typeof rawDiscount === 'number') {
        discountVal = rawDiscount > 1 ? rawDiscount / 100 : rawDiscount;
      }
    }

    // 模板名称
    const templateName = `${productCode}-${effectiveDate.replace(/\//g, '')}`;

    customerSet.add(customerCode);

    // 对每个重量段生成一行
    for (const rangeName of SYSTEM_WEIGHT_RANGES) {
      // 用多候选+模糊匹配查找价格
      const candidates = RANGE_COL_CANDIDATES[rangeName];
      let priceVal = candidates ? findPrice(row, candidates) : '';

      // 规则：0-3 和 3-20 的运费金额空着
      if (rangeName === '0-3' || rangeName === '3-20') {
        priceVal = '';
      }

      // 规则：折扣 - 0-3/3-20 用原折扣，其他填 1
      let rangeDiscount: number | string = 1;
      if (rangeName === '0-3' || rangeName === '3-20') {
        rangeDiscount = discountVal;
      }

      // 规则：首重/续重费用
      let firstWeightFee: number | string = '';
      let additionalWeightFee: number | string = '';

      if (rangeName === '0-3') {
        firstWeightFee = 295;
        additionalWeightFee = 75;
      } else if (rangeName === '3-20') {
        firstWeightFee = 670;
        additionalWeightFee = 80;
      }

      rows.push({
        客户代码: customerCode,
        产品代码: productCode,
        计费地: '',
        货物类型: '包裹',
        模板类型: '公布价',
        模板名称: templateName,
        币别: 'RMB',
        生效时间: effectiveDate,
        分区名称: '日本',
        重量段标题: rangeName,
        运费金额: priceVal,
        特殊处理费: '',
        首重费用: firstWeightFee,
        续重费用: additionalWeightFee,
        折扣: rangeDiscount,
      });
    }
  }

  return {
    rows,
    totalRecords: rows.length,
    customerCount: customerSet.size,
  };
}

/** 格式化日期为 YYYY/MM/DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
