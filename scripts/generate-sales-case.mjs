import { mkdir, writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';

// Deterministic synthetic data; each order contains one SKU and one region/channel.
const products = [
  ['COF-01', '晨光咖啡机', '厨房电器', 899, 480, 620],
  ['AIR-01', '轻食空气炸锅', '厨房电器', 499, 260, 550],
  ['KET-01', '恒温电热水壶', '厨房电器', 199, 90, 480],
  ['FIL-01', '咖啡滤芯套装', '耗材', 59, 20, 420],
];
const regions = ['华东', '华南', '华北'];
const channels = ['自营商城', '平台店'];
const money = (value) => Math.round(value * 100) / 100;
const rows = [];
for (let month = 1; month <= 2; month++) {
  const days = month === 1 ? 31 : 28;
  for (let day = 1; day <= days; day++) {
    const date = `2025-${String(month).padStart(2, '0')}-${String(day).padStart(
      2,
      '0',
    )}`;
    const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    for (const [
      p,
      [sku, product, category, price, cost, traffic],
    ] of products.entries()) {
      for (const [r, region] of regions.entries()) {
        for (const [c, channel] of channels.entries()) {
          let sessions = Math.round(
            traffic * (1 - r * 0.13) * (c ? 1.2 : 1) * (weekend ? 1.15 : 1) +
              ((day * 7 + p * 11 + r * 3) % 35),
          );
          let conversion = 0.055 + p * 0.008;
          let discount = c ? 0.08 : 0.04;
          let returns = 0.025;
          let adRate = c ? 0.38 : 0.18;
          let stockout = 0;
          let campaign = '常规经营';
          if (month === 2 && p === 0 && r === 0 && c === 1) {
            sessions = Math.round(sessions * 1.28);
            conversion *= 1.06;
            discount = 0.27;
            adRate = 1.35;
            returns = day >= 8 ? 0.19 : 0.05;
            campaign = '春节促销';
          }
          if (month === 2 && p === 0 && r === 2 && c === 0 && day >= 15) {
            stockout = 12;
            conversion *= 0.42;
          }
          if (month === 2 && p === 1 && r === 1 && c === 0) {
            sessions = Math.round(sessions * 1.3);
            conversion *= 1.1;
            campaign = '新品组合推荐';
          }
          if (month === 2 && p === 2 && c === 1) {
            sessions = Math.round(sessions * 1.12);
            discount = 0.22;
            adRate = 0.55;
            campaign = '限时折扣';
          }
          if (month === 2 && day === 3 && p === 3 && r === 1 && c === 0) {
            sessions = 0;
            stockout = 24;
          }
          const orders = Math.round(sessions * conversion);
          const units = orders + Math.floor(orders / 8);
          const returned = Math.round(units * returns);
          const gross = money(units * price);
          const discountAmount = money(gross * discount);
          const refund = money(returned * price * (1 - discount));
          rows.push({
            date,
            region,
            channel,
            sku,
            product,
            category,
            campaign,
            sessions,
            orders,
            units,
            returned_units: returned,
            list_price: price,
            gross_sales: gross,
            discount_amount: discountAmount,
            refund_amount: returned === 0 && day % 3 === 0 ? null : refund,
            cogs: money((units - returned) * cost),
            fulfillment_cost: money(units * (c ? 8 : 10)),
            platform_fee: money((gross - discountAmount) * (c ? 0.035 : 0.008)),
            ad_spend: money(sessions * adRate),
            stockout_hours: stockout,
          });
        }
      }
    }
  }
}
const headers = Object.keys(rows[0]);
await mkdir('examples/sales', { recursive: true });
await writeFile(
  'examples/sales/sales-case.csv',
  [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => row[key] ?? '').join(',')),
  ].join('\n') + '\n',
);

const descriptions = {
  date: '营业自然日，ISO 日期；按原销售日期归属退款；数据快照截止 2025-03-31，两个销售月退款均已成熟。',
  region: '销售归属地区。',
  channel: '销售渠道。',
  sku: '商品唯一编码。',
  product: '商品名称。',
  category: '商品品类。',
  campaign: '观察到的活动标签，不代表活动因果效果。',
  sessions: '归属该商品×地区×渠道的访问次数，可加总，不是去重访客数。',
  orders:
    '已支付订单数；本合成案例每单只包含一个 SKU，可跨行加总；不含取消和未支付订单。',
  units: '已发货件数，含后续退回件数；一个订单可能购买多件同 SKU。',
  returned_units:
    '已全额退款的退货件数，不是退款订单数；退款件数率 = SUM(returned_units)/SUM(units)。',
  list_price: '每件标价，人民币元；不按行求和。',
  gross_sales: '标价销售额 = units × list_price，未扣优惠和退款，人民币元。',
  discount_amount:
    '发货商品实际优惠金额，人民币元；包含后续退款商品享受的优惠。',
  refund_amount:
    '按折后实付价计算的累计退款金额，人民币元；空值明确表示零退款。不可再按退货件数重复扣减收入。',
  cogs: '扣除可再次销售的退货商品成本回收后的商品成本，人民币元；已经是净成本，不可再扣退货成本。',
  fulfillment_cost: '发货履约成本，退货后不退还，人民币元。',
  platform_fee: '按折后支付金额计算的交易费用，退款后不退还，人民币元。',
  ad_spend:
    '分配至此行粒度的实际广告费用，人民币元，可加总；没有投放实验或增量收益数据。',
  stockout_hours:
    '此商品×地区×渠道当天缺货小时，范围 0–24；跨商品求和不等于营业小时，建议按组合比较平均值。',
};
const net = 'gross_sales - discount_amount - COALESCE(refund_amount, 0)';
const contribution = `${net} - cogs - fulfillment_cost - platform_fee - ad_spend`;
const semantic = {
  description:
    '合成家电零售经营数据。用于多轮探索和证据链演示，不是真实业务数据。金额均为人民币元。先验证统计范围与口径，再比较经营表现。',
  properties: {
    grain:
      '一行 = 一个自然日 × 一个商品 SKU × 一个地区 × 一个渠道；所有组合每天都有记录，包括零访问零订单日。',
    accounting:
      '净销售额 = 标价销售额 - 优惠 - 退款；广告后经营贡献 = 净销售额 - 商品净成本 - 履约成本 - 交易费 - 广告费用。此贡献不含固定人工、租金及所得税，不能称为净利润。',
    comparison:
      '2025 年 1 月 31 天、2 月 28 天。总量与自然日日均都要报告；跨组合的贡献拆解必须采用相同的月份分母。比率使用汇总后的分子/分母；零分母用 NULLIF 返回 NULL，不填 0；不平均各行转化率。',
    queryRules:
      'CSV 实际物理表为 data。所有 SQL 使用 data 和物理字段。语义计算列和 cube 不会自动创建数据库列或视图，必须展开表达式或使用 CTE。金额保留计算精度，仅展示时四舍五入。',
    analysisGuidance: [
      '先验证日期覆盖、每日组合完整性、复合键唯一性、空值和零值，再核对金额恒等式；不要从前五行推断整体。',
      '比较月总量与自然日日均净销售额、广告后经营贡献；把月份天数与经营强度变化区分开。',
      '从商品、地区、渠道逐层下钻到交叉组合；同时列出负向贡献和抵消下降的正向贡献，并与总体差额对账。',
      '对关键组合检查日趋势、销量、折后价格、退款件数率、广告费及缺货小时；根据上一步结果选择下一步，不强制固定 SQL。',
      '经营贡献的会计桥 = 标价销售额变化 - 优惠变化 - 退款变化 - 商品成本变化 - 履约成本变化 - 交易费变化 - 广告费变化。分项必须与总体变化一致。',
      '活动、广告、缺货与经营变化的同时出现是线索，不自动构成因果；不能据此给出确定的投放增量回报或预算。优先建议可核查的操作及所需补充证据。',
    ],
    loopPresentation:
      '遵守 AVA loop 协议。EXPLORE 在代码块前写 -- Purpose: 简短中文目的；REFINE 用 Findings: 总结已返回结果、Plan: 描述下一步；SQL 只提供代码块；CONFIRM 用 Verification: 和 Conclusion: 给出核验及中文结论。结论只能引用已经执行的结果，不能提前宣称当前未执行查询的发现。',
  },
  models: [
    {
      name: 'data',
      tableReference: { table: 'data' },
      primaryKey: ['date', 'sku', 'region', 'channel'],
      columns: headers.map((name) => ({
        name,
        type:
          name === 'date'
            ? 'DATE'
            : [
                'region',
                'channel',
                'sku',
                'product',
                'category',
                'campaign',
              ].includes(name)
            ? 'VARCHAR'
            : [
                'sessions',
                'orders',
                'units',
                'returned_units',
                'stockout_hours',
              ].includes(name)
            ? 'BIGINT'
            : 'DOUBLE',
        properties: { description: descriptions[name] },
      })),
    },
  ],
  cubes: [
    {
      name: 'retail_sales',
      baseObject: 'data',
      measures: [
        {
          name: 'net_revenue',
          type: 'DOUBLE',
          expression: `SUM(${net})`,
          description: '净销售额，人民币元。',
        },
        {
          name: 'contribution_after_ads',
          type: 'DOUBLE',
          expression: `SUM(${contribution})`,
          description: '广告后经营贡献，人民币元，不是净利润。',
        },
        {
          name: 'daily_net_revenue',
          type: 'DOUBLE',
          expression: `SUM(${net}) / NULLIF(COUNT(DISTINCT date), 0)`,
        },
        {
          name: 'daily_contribution_after_ads',
          type: 'DOUBLE',
          expression: `SUM(${contribution}) / NULLIF(COUNT(DISTINCT date), 0)`,
        },
        {
          name: 'conversion_rate',
          type: 'DOUBLE',
          expression: 'SUM(orders)::DOUBLE / NULLIF(SUM(sessions), 0)',
        },
        {
          name: 'return_rate',
          type: 'DOUBLE',
          expression: 'SUM(returned_units)::DOUBLE / NULLIF(SUM(units), 0)',
        },
        {
          name: 'net_order_value',
          type: 'DOUBLE',
          expression: `SUM(${net}) / NULLIF(SUM(orders), 0)`,
        },
      ],
      dimensions: [
        'region',
        'channel',
        'sku',
        'product',
        'category',
        'campaign',
      ].map((name) => ({ name, expression: name, type: 'VARCHAR' })),
      timeDimensions: [
        { name: 'sales_date', expression: 'date', type: 'DATE' },
      ],
      hierarchies: { product_path: ['category', 'product', 'sku'] },
    },
  ],
};
await writeFile('examples/sales/sales-semantic.yaml', stringify(semantic, { lineWidth: 100 }));
await writeFile(
  'examples/sales/sales-question.txt',
  '2025 年 2 月是否只是月份变短才显得业绩下滑？请先核验数据和经营贡献口径，比较 1 月、2 月的总量和日均净销售额、广告后经营贡献，再逐层找到拉低可比日均贡献的主要商品×地区×渠道组合，区分销量、折扣退款、广告成本和库存信号。给出有数据支持的优先处理建议及仍待验证的假设。按证据决定下一步，不预设固定查询；每轮说明目的，在拿到结果后总结发现，最后核对分项与整体是否一致。\n',
);

const totals = new Map();
for (const row of rows) {
  const month = row.date.slice(0, 7);
  const total = totals.get(month) || {
    days: month.endsWith('01') ? 31 : 28,
    rows: 0,
    net_revenue: 0,
    contribution_after_ads: 0,
  };
  const revenue =
    row.gross_sales - row.discount_amount - (row.refund_amount || 0);
  total.rows++;
  total.net_revenue += revenue;
  total.contribution_after_ads +=
    revenue - row.cogs - row.fulfillment_cost - row.platform_fee - row.ad_spend;
  totals.set(month, total);
}
await mkdir('tests/fixtures', { recursive: true });
await writeFile(
  'tests/fixtures/sales-expected.json',
  JSON.stringify(
    Object.fromEntries(
      [...totals].map(([month, value]) => [
        month,
        {
          ...value,
          net_revenue: money(value.net_revenue),
          contribution_after_ads: money(value.contribution_after_ads),
        },
      ]),
    ),
    null,
    2,
  ) + '\n',
);
console.log(`Generated ${rows.length} rows and AVA semantic metadata.`);
