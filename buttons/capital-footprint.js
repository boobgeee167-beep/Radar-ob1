
/**
 * WHALE RADAR
 * CAPITAL FOOTPRINT
 * Central Data Engine Edition
 */

import { fetchMarketData } from "../core/market-data.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>💰 رادار بصمة رأس المال</h3>
            <p>جارٍ تحليل توزيع رؤوس الأموال على مستويات الأسعار...</p>
        </div>
    `;

    try {

        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        // استخراج أعلى 10% من التنفيذات حسب القيمة
        const sortedTrades = [...trades].sort(
            (a, b) => b.value - a.value
        );

        const topCount = Math.max(
            1,
            Math.ceil(sortedTrades.length * 0.10)
        );

        const majorTrades = sortedTrades.slice(0, topCount);

        // تحديد نطاق الأسعار
        const prices = majorTrades.map(trade => trade.price);

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        const LEVELS = 20;

        const priceRange = maxPrice - minPrice;

        const levelSize = priceRange > 0
            ? priceRange / LEVELS
            : 0;

        const footprint = Array.from(
            { length: LEVELS },
            (_, index) => {

                const lower = minPrice + index * levelSize;

                return {
                    lower,
                    upper: lower + levelSize,
                    buyValue: 0,
                    sellValue: 0,
                    count: 0
                };

            }
        );

        // توزيع التنفيذات على المستويات السعرية
        for (const trade of majorTrades) {

            let index = priceRange > 0
                ? Math.floor(
                    (trade.price - minPrice) / levelSize
                )
                : 0;

            index = Math.min(LEVELS - 1, Math.max(0, index));

            const level = footprint[index];

            level.count++;

            if (trade.buyerIsMaker) {
                level.sellValue += trade.value;
            } else {
                level.buyValue += trade.value;
            }

        }

        footprint.reverse();

        // إجماليات رأس المال
        const totalBuy = majorTrades.reduce(
            (sum, trade) =>
                sum + (trade.buyerIsMaker ? 0 : trade.value),
            0
        );

        const totalSell = majorTrades.reduce(
            (sum, trade) =>
                sum + (trade.buyerIsMaker ? trade.value : 0),
            0
        );

        const totalValue = totalBuy + totalSell;

        const strongestLevel = [...footprint].sort(
            (a, b) =>
                (b.buyValue + b.sellValue) -
                (a.buyValue + a.sellValue)
        )[0];

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatPrice = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        // عرض مستويات الأسعار
        const rows = footprint
            .map(level => {

                const levelTotal =
                    level.buyValue + level.sellValue;

                const buyPercent = levelTotal > 0
                    ? (level.buyValue / levelTotal) * 100
                    : 0;

                const sellPercent = levelTotal > 0
                    ? (level.sellValue / levelTotal) * 100
                    : 0;

                return `
                    <div class="trade-row">

                        <div>
                            <strong>${formatPrice(level.upper)}</strong>
                            <small>${formatPrice(level.lower)}</small>
                        </div>

                        <div>
                            <strong>${formatMoney(levelTotal)}</strong>
                            <small>${level.count} تنفيذ</small>
                        </div>

                        <div>
                            <strong class="buy">
                                ${formatMoney(level.buyValue)}
                            </strong>
                            <small class="sell">
                                ${formatMoney(level.sellValue)}
                            </small>
                        </div>

                        <div>
                            <small>شراء ${buyPercent.toFixed(1)}%</small>
                            <small>بيع ${sellPercent.toFixed(1)}%</small>
                        </div>

                    </div>
                `;

            }).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>💰 تحليل بصمة رأس المال</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${market.symbol}</strong>
                    </div>

                    <div>
                        <small>الصفقات المحللة</small>
                        <strong>${market.totalTrades.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>التنفيذات الكبيرة</small>
                        <strong>${majorTrades.length.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>قيمة رأس المال المرصود</small>
                        <strong>${formatMoney(totalValue)}</strong>
                    </div>

                </div>

                <h4>توزيع رأس المال</h4>

                <div class="trade-summary">

                    <div>
                        <small>الشراء المبادر</small>
                        <strong class="buy">${formatMoney(totalBuy)}</strong>
                    </div>

                    <div>
                        <small>البيع المبادر</small>
                        <strong class="sell">${formatMoney(totalSell)}</strong>
                    </div>

                </div>

                <h4>أقوى منطقة تركّز لرأس المال</h4>

                <div class="analysis-note">

                    <strong>
                        ${formatPrice(strongestLevel.lower)}
                        — ${formatPrice(strongestLevel.upper)}
                    </strong>

                    <p>
                        إجمالي التنفيذات:
                        ${formatMoney(
                            strongestLevel.buyValue +
                            strongestLevel.sellValue
                        )}
                    </p>

                </div>

                <h4>البصمة السعرية لرأس المال</h4>

                ${rows}

                <p class="analysis-note">
                    تم تحليل أعلى 10% من التنفيذات حسب القيمة،
                    وتوزيعها على ${LEVELS} مستوى سعرياً.
                    هذه بصمة تنفيذات تاريخية وليست دليلاً
                    على ملكية رأس المال أو استمرار الأوامر في دفتر السوق.
                </p>

            </div>

        `;

    } catch (error) {

        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال التحليل</h3>
                <p>${error.message}</p>
            </div>
        `;

    }

}
