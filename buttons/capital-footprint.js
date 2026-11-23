
/**
 * WHALE RADAR
 * CAPITAL FOOTPRINT
 *
 * تحليل تمركز القيمة الكبيرة على المستويات السعرية.
 */

import { fetchMarketData } from "../core/market-data.js";
import { renderDashboard } from "../core/results-ui.js";

const TOP_PERCENT = 10;
const PRICE_BUCKETS = 20;
const MAX_ROWS = 20;

const formatMoney = value =>
    "$" + Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 2
    });

const formatPrice = value =>
    Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 10
    });

function calculatePercentile(sorted, percentile) {
    if (!sorted.length) return 0;

    const index = Math.min(
        sorted.length - 1,
        Math.floor((sorted.length - 1) * percentile)
    );

    return sorted[index];
}

function analyzeCapital(trades) {
    const sorted = [...trades].sort(
        (a, b) => b.value - a.value
    );

    const selectedCount = Math.max(
        1,
        Math.ceil(trades.length * TOP_PERCENT / 100)
    );

    const selected = sorted.slice(0, selectedCount);

    const totalCapital = selected.reduce(
        (sum, trade) => sum + trade.value,
        0
    );

    let buyCapital = 0;
    let sellCapital = 0;

    for (const trade of selected) {
        if (trade.buyerIsMaker) {
            sellCapital += trade.value;
        } else {
            buyCapital += trade.value;
        }
    }

    const prices = selected.map(trade => trade.price);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    const priceRange = maxPrice - minPrice;

    const buckets = Array.from(
        { length: PRICE_BUCKETS },
        (_, index) => ({
            index,
            minPrice: minPrice + priceRange * index / PRICE_BUCKETS,
            maxPrice: minPrice + priceRange * (index + 1) / PRICE_BUCKETS,
            buyValue: 0,
            sellValue: 0,
            totalValue: 0,
            tradeCount: 0
        })
    );

    for (const trade of selected) {
        let index = priceRange === 0
            ? 0
            : Math.floor(
                (trade.price - minPrice) / priceRange * PRICE_BUCKETS
            );

        index = Math.min(PRICE_BUCKETS - 1, Math.max(0, index));

        const bucket = buckets[index];

        bucket.totalValue += trade.value;
        bucket.tradeCount++;

        if (trade.buyerIsMaker) {
            bucket.sellValue += trade.value;
        } else {
            bucket.buyValue += trade.value;
        }
    }

    const activeBuckets = buckets
        .filter(bucket => bucket.tradeCount > 0)
        .sort((a, b) => b.totalValue - a.totalValue);

    const strongestBucket = activeBuckets[0] || null;

    const medianValue = calculatePercentile(
        [...trades.map(trade => trade.value)].sort((a, b) => a - b),
        0.5
    );

    const averageValue = trades.reduce(
        (sum, trade) => sum + trade.value,
        0
    ) / trades.length;

    return {
        selected,
        selectedCount,
        totalCapital,
        buyCapital,
        sellCapital,
        buckets: activeBuckets,
        strongestBucket,
        minPrice,
        maxPrice,
        medianValue,
        averageValue
    };
}

export async function run(settings) {
    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>💰 تحليل بصمة رأس المال</h3>
            <p>جارٍ استخراج أكبر التنفيذات وتوزيعها سعرياً...</p>
        </div>
    `;

    try {
        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد تنفيذات ضمن الفترة المحددة");
        }

        const analysis = analyzeCapital(trades);

        const totalCapital = analysis.totalCapital;

        const buyPercent = totalCapital > 0
            ? analysis.buyCapital / totalCapital * 100
            : 0;

        const sellPercent = totalCapital > 0
            ? analysis.sellCapital / totalCapital * 100
            : 0;

        const bucketRows = analysis.buckets
            .slice(0, MAX_ROWS)
            .map((bucket, index) => [
                `#${index + 1}`,
                formatPrice(bucket.minPrice),
                formatPrice(bucket.maxPrice),
                bucket.tradeCount.toLocaleString(),
                formatMoney(bucket.totalValue),
                formatMoney(bucket.buyValue),
                formatMoney(bucket.sellValue)
            ]);

        const strongest = analysis.strongestBucket;

        const strongestDescription = strongest
            ? `أقوى نطاق سعري امتد من ${formatPrice(strongest.minPrice)} إلى ${formatPrice(strongest.maxPrice)}، وتركزت فيه قيمة ${formatMoney(strongest.totalValue)}.`
            : "لم يتم العثور على نطاق سعري نشط.";

        renderDashboard({
            title: "💰 رادار بصمة رأس المال",
            symbol: market.symbol,
            subtitle: "تحديد مناطق تمركز أكبر قيم التنفيذ",

            metrics: [
                {
                    label: "التنفيذات المحللة",
                    value: market.totalTrades.toLocaleString(),
                    tone: "blue",
                    detail: `${market.pages} دفعات بيانات`
                },
                {
                    label: "التنفيذات الكبيرة المختارة",
                    value: analysis.selectedCount.toLocaleString(),
                    tone: "gold",
                    detail: `أعلى ${TOP_PERCENT}% من التنفيذات`
                },
                {
                    label: "قيمة رأس المال المختار",
                    value: formatMoney(totalCapital),
                    tone: "gold"
                },
                {
                    label: "متوسط قيمة التنفيذ",
                    value: formatMoney(analysis.averageValue),
                    tone: "blue"
                }
            ],

            sections: [
                {
                    type: "bars",
                    title: "اتجاه المبادرة لرأس المال الكبير",
                    description: "توزيع قيمة أكبر التنفيذات حسب جهة المبادرة",

                    items: [
                        {
                            label: "شراء مبادر",
                            value: analysis.buyCapital,
                            display: `${formatMoney(analysis.buyCapital)} — ${buyPercent.toFixed(1)}%`,
                            tone: "buy"
                        },
                        {
                            label: "بيع مبادر",
                            value: analysis.sellCapital,
                            display: `${formatMoney(analysis.sellCapital)} — ${sellPercent.toFixed(1)}%`,
                            tone: "sell"
                        }
                    ]
                },

                {
                    type: "table",
                    title: "خريطة تمركز رأس المال",
                    description: `تقسيم النطاق السعري إلى ${PRICE_BUCKETS} نطاقاً، مرتبة حسب قيمة التنفيذات الكبيرة`,

                    columns: [
                        "الترتيب",
                        "من السعر",
                        "إلى السعر",
                        "عدد التنفيذات",
                        "إجمالي القيمة",
                        "شراء مبادر",
                        "بيع مبادر"
                    ],

                    rows: bucketRows
                },

                {
                    type: "note",
                    title: "أقوى منطقة تمركز",

                    text: strongestDescription
                },

                {
                    type: "note",
                    title: "قراءة الرادار",

                    text:
                        `تم اختيار أعلى ${TOP_PERCENT}% من التنفيذات حسب القيمة، ` +
                        `وتم تحليل ${analysis.selectedCount.toLocaleString()} تنفيذات. ` +
                        `بلغت قيمتها الإجمالية ${formatMoney(totalCapital)}. ` +
                        `الشراء المبادر يمثل ${buyPercent.toFixed(2)}%، ` +
                        `والبيع المبادر يمثل ${sellPercent.toFixed(2)}%. ` +
                        `متوسط قيمة التنفيذ في كامل العينة ${formatMoney(analysis.averageValue)}، ` +
                        `والقيمة الوسيطة ${formatMoney(analysis.medianValue)}. ` +
                        `هذه بصمة لتوزيع التنفيذات المرصودة وليست دليلاً على ملكية حساب واحد أو تجميع متعمد.`
                }
            ]
        });

    } catch (error) {
        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال تحليل رأس المال</h3>
                <p>${String(error.message || error)}</p>
            </div>
        `;
    }
}
