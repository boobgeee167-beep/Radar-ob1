
/**
 * WHALE RADAR
 * HIDDEN ORDERS & LIQUIDITY RADAR
 *
 * يرصد:
 * 1. تكرار التنفيذ عند مستويات سعرية محددة.
 * 2. جدران السيولة الظاهرة في دفتر الأوامر.
 * 3. توافق التنفيذات مع مستويات السيولة.
 * 4. مؤشرات إعادة تعبئة السيولة المحتملة.
 *
 * تنبيه:
 * البيانات العامة لا تثبت وجود Iceberg أو هوية جهة واحدة.
 */

import { fetchMarketData } from "../core/market-data.js";
import { renderDashboard } from "../core/results-ui.js";

const DEPTH_LIMIT = 100;
const PRICE_LEVELS_LIMIT = 15;
const REPEAT_MINIMUM = 5;

const formatMoney = value =>
    "$" + Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 2
    });

const formatPrice = value =>
    Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 10
    });

const formatNumber = value =>
    Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 4
    });

function groupTradesByPrice(trades) {
    const levels = new Map();

    for (const trade of trades) {
        const key = String(trade.price);

        if (!levels.has(key)) {
            levels.set(key, {
                price: trade.price,
                count: 0,
                buyValue: 0,
                sellValue: 0,
                totalValue: 0,
                quantity: 0
            });
        }

        const level = levels.get(key);

        level.count++;
        level.totalValue += trade.value;
        level.quantity += trade.quantity;

        if (trade.buyerIsMaker) {
            level.sellValue += trade.value;
        } else {
            level.buyValue += trade.value;
        }
    }

    return [...levels.values()]
        .sort((a, b) => b.totalValue - a.totalValue);
}

async function fetchOrderBook(symbol) {
    const endpoints = [
        "https://data-api.binance.vision",
        "https://api4.binance.com",
        "https://api1.binance.com"
    ];

    let lastError;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(
                `${endpoint}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${DEPTH_LIMIT}`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!Array.isArray(data.bids) || !Array.isArray(data.asks)) {
                throw new Error("بيانات دفتر الأوامر غير صالحة");
            }

            return data;

        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(
        "تعذر جلب دفتر الأوامر: " +
        (lastError?.message || "خطأ غير معروف")
    );
}

function analyzeWalls(orderBook) {
    const bids = orderBook.bids.map(([price, quantity]) => ({
        price: Number(price),
        quantity: Number(quantity),
        value: Number(price) * Number(quantity),
        side: "شراء"
    }));

    const asks = orderBook.asks.map(([price, quantity]) => ({
        price: Number(price),
        quantity: Number(quantity),
        value: Number(price) * Number(quantity),
        side: "بيع"
    }));

    const all = [...bids, ...asks];

    const average =
        all.reduce((sum, item) => sum + item.value, 0) /
        Math.max(all.length, 1);

    const threshold = average * 3;

    const walls = all
        .filter(item => item.value >= threshold)
        .sort((a, b) => b.value - a.value)
        .slice(0, PRICE_LEVELS_LIMIT);

    return {
        bids,
        asks,
        walls,
        totalBidValue: bids.reduce((sum, item) => sum + item.value, 0),
        totalAskValue: asks.reduce((sum, item) => sum + item.value, 0)
    };
}

function matchWallsWithTrades(walls, levels) {
    const tolerance = 0.001;

    return walls.map(wall => {
        const matching = levels.filter(level =>
            Math.abs(level.price - wall.price) / wall.price <= tolerance
        );

        const executions = matching.reduce(
            (sum, level) => sum + level.totalValue,
            0
        );

        const count = matching.reduce(
            (sum, level) => sum + level.count,
            0
        );

        return {
            ...wall,
            executions,
            executionCount: count,
            hasActivity: count > 0
        };
    });
}

export async function run(settings) {
    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🧊 رادار السيولة والأوامر المخفية</h3>
            <p>جارٍ تحليل مستويات الأسعار ودفتر الأوامر...</p>
        </div>
    `;

    try {
        const [market, orderBook] = await Promise.all([
            fetchMarketData(settings),
            fetchOrderBook(settings.symbol)
        ]);

        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد تنفيذات ضمن الفترة المحددة");
        }

        const levels = groupTradesByPrice(trades);

        const repeatedLevels = levels
            .filter(level => level.count >= REPEAT_MINIMUM)
            .sort((a, b) => b.count - a.count);

        const liquidity = analyzeWalls(orderBook);

        const matchedWalls = matchWallsWithTrades(
            liquidity.walls,
            levels
        );

        const buyWalls = matchedWalls.filter(
            wall => wall.side === "شراء"
        );

        const sellWalls = matchedWalls.filter(
            wall => wall.side === "بيع"
        );

        const strongestRepeated = repeatedLevels.slice(
            0,
            PRICE_LEVELS_LIMIT
        );

        const totalDepth =
            liquidity.totalBidValue + liquidity.totalAskValue;

        const bidPercent = totalDepth > 0
            ? liquidity.totalBidValue / totalDepth * 100
            : 0;

        const askPercent = totalDepth > 0
            ? liquidity.totalAskValue / totalDepth * 100
            : 0;

        const wallRows = matchedWalls.map((wall, index) => [
            `#${index + 1}`,
            wall.side,
            formatPrice(wall.price),
            formatMoney(wall.value),
            formatNumber(wall.quantity),
            formatMoney(wall.executions),
            wall.executionCount.toLocaleString(),
            wall.hasActivity ? "نشاط مرصود" : "لا يوجد تطابق"
        ]);

        const repeatedRows = strongestRepeated.map(
            (level, index) => [
                `#${index + 1}`,
                formatPrice(level.price),
                level.count.toLocaleString(),
                formatMoney(level.totalValue),
                formatMoney(level.buyValue),
                formatMoney(level.sellValue)
            ]
        );

        const totalRepeatedValue = repeatedLevels.reduce(
            (sum, level) => sum + level.totalValue,
            0
        );

        const totalWallValue = matchedWalls.reduce(
            (sum, wall) => sum + wall.value,
            0
        );

        renderDashboard({
            title: "🧊 رادار السيولة والأوامر المخفية",
            symbol: market.symbol,
            subtitle: "تحليل تكرار التنفيذ وجدران دفتر الأوامر",

            metrics: [
                {
                    label: "مستويات التنفيذ المتكررة",
                    value: repeatedLevels.length.toLocaleString(),
                    tone: "blue",
                    detail: `الحد الأدنى ${REPEAT_MINIMUM} تنفيذات`
                },
                {
                    label: "جدران السيولة المرصودة",
                    value: matchedWalls.length.toLocaleString(),
                    tone: "gold"
                },
                {
                    label: "إجمالي سيولة الشراء",
                    value: formatMoney(liquidity.totalBidValue),
                    tone: "buy"
                },
                {
                    label: "إجمالي سيولة البيع",
                    value: formatMoney(liquidity.totalAskValue),
                    tone: "sell"
                }
            ],

            sections: [
                {
                    type: "bars",
                    title: "ميزان السيولة في دفتر الأوامر",
                    description: "مقارنة قيمة أوامر الشراء والبيع الظاهرة",

                    items: [
                        {
                            label: "سيولة الشراء",
                            value: liquidity.totalBidValue,
                            display: `${formatMoney(liquidity.totalBidValue)} — ${bidPercent.toFixed(1)}%`,
                            tone: "buy"
                        },
                        {
                            label: "سيولة البيع",
                            value: liquidity.totalAskValue,
                            display: `${formatMoney(liquidity.totalAskValue)} — ${askPercent.toFixed(1)}%`,
                            tone: "sell"
                        }
                    ]
                },

                {
                    type: "table",
                    title: "أقوى جدران السيولة",
                    description: "مستويات كبيرة نسبياً مقارنة بمتوسط قيمة الأوامر الظاهرة",

                    columns: [
                        "الترتيب",
                        "الجانب",
                        "السعر",
                        "قيمة الجدار",
                        "الكمية",
                        "التنفيذات المطابقة",
                        "عددها",
                        "النشاط"
                    ],

                    rows: wallRows
                },

                {
                    type: "table",
                    title: "مستويات تكرار التنفيذ",
                    description: "الأسعار التي شهدت خمس تنفيذات أو أكثر خلال الفترة المحددة",

                    columns: [
                        "الترتيب",
                        "السعر",
                        "عدد التنفيذات",
                        "القيمة الإجمالية",
                        "شراء مبادر",
                        "بيع مبادر"
                    ],

                    rows: repeatedRows
                },

                {
                    type: "note",
                    title: "قراءة الرادار",

                    text:
                        `رُصد ${repeatedLevels.length} مستوى سعري متكرر، ` +
                        `بقيمة تنفيذات إجمالية ${formatMoney(totalRepeatedValue)}. ` +
                        `بلغت قيمة جدران السيولة المرصودة ${formatMoney(totalWallValue)}. ` +
                        `منها ${buyWalls.length} جدران شراء و${sellWalls.length} جدران بيع. ` +
                        `التطابق بين الجدار والتنفيذات يشير إلى نشاط عند مستوى قريب، ` +
                        `لكنه لا يثبت إعادة تعبئة الأمر أو وجود Iceberg. ` +
                        `دفتر الأوامر لقطة لحظية وقد تتغير أوامره أو تُلغى.`
                }
            ]
        });

    } catch (error) {
        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال تحليل السيولة</h3>
                <p>${String(error.message || error)}</p>
            </div>
        `;
    }
                        }
