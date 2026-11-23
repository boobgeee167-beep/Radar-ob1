
/**
 * WHALE RADAR
 * BUY / SELL ACTIVITY
 * Central Data Engine Edition
 */

import { fetchMarketData } from "../core/market-data.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>⚖️ رادار نشاط الشراء والبيع</h3>
            <p>جارٍ تحليل تدفق التنفيذات...</p>
        </div>
    `;

    try {

        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        // إجماليات السوق
        let totalBuy = 0;
        let totalSell = 0;
        let buyCount = 0;
        let sellCount = 0;

        for (const trade of trades) {

            if (trade.buyerIsMaker) {
                totalSell += trade.value;
                sellCount++;
            } else {
                totalBuy += trade.value;
                buyCount++;
            }

        }

        const totalValue = totalBuy + totalSell;

        const buyPercent = totalValue > 0
            ? totalBuy / totalValue * 100
            : 0;

        const sellPercent = totalValue > 0
            ? totalSell / totalValue * 100
            : 0;

        // تقسيم البيانات إلى نوافذ زمنية
        const WINDOW_MS = 60 * 1000;

        const windows = new Map();

        for (const trade of trades) {

            const key =
                Math.floor(trade.time / WINDOW_MS) * WINDOW_MS;

            if (!windows.has(key)) {

                windows.set(key, {
                    time: key,
                    buyValue: 0,
                    sellValue: 0,
                    buyCount: 0,
                    sellCount: 0
                });

            }

            const window = windows.get(key);

            if (trade.buyerIsMaker) {
                window.sellValue += trade.value;
                window.sellCount++;
            } else {
                window.buyValue += trade.value;
                window.buyCount++;
            }

        }

        const activity = [...windows.values()]
            .sort((a, b) => a.time - b.time);

        // أقوى فترات النشاط
        const strongestBuy = [...activity].sort(
            (a, b) => b.buyValue - a.buyValue
        )[0];

        const strongestSell = [...activity].sort(
            (a, b) => b.sellValue - a.sellValue
        )[0];

        // تحليل التحولات في ضغط المبادرة
        const transitions = [];

        let previousDirection = null;

        for (const window of activity) {

            let direction = "متوازن";

            if (window.buyValue > window.sellValue * 1.2) {
                direction = "شراء";
            } else if (
                window.sellValue > window.buyValue * 1.2
            ) {
                direction = "بيع";
            }

            if (
                previousDirection &&
                direction !== previousDirection
            ) {

                transitions.push({
                    time: window.time,
                    from: previousDirection,
                    to: direction
                });

            }

            previousDirection = direction;

        }

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        // آخر 30 فترة زمنية
        const recentActivity = activity.slice(-30);

        const maxActivity = Math.max(
            1,
            ...recentActivity.map(window =>
                window.buyValue + window.sellValue
            )
        );

        const activityRows = recentActivity
            .slice()
            .reverse()
            .map(window => {

                const total =
                    window.buyValue + window.sellValue;

                const buyWidth =
                    total > 0
                        ? window.buyValue / total * 100
                        : 0;

                const sellWidth = 100 - buyWidth;

                return `
                    <div class="trade-row">

                        <div>
                            <strong>${formatTime(window.time)}</strong>
                            <small>
                                ${window.buyCount + window.sellCount}
                                تنفيذ
                            </small>
                        </div>

                        <div>
                            <strong class="buy">
                                ${formatMoney(window.buyValue)}
                            </strong>
                            <small class="sell">
                                ${formatMoney(window.sellValue)}
                            </small>
                        </div>

                        <div style="min-width:90px">

                            <div style="
                                display:flex;
                                height:9px;
                                overflow:hidden;
                                border-radius:8px;
                                background:#333;
                            ">

                                <div style="
                                    width:${buyWidth}%;
                                    background:#16c784;
                                "></div>

                                <div style="
                                    width:${sellWidth}%;
                                    background:#ea3943;
                                "></div>

                            </div>

                        </div>

                    </div>
                `;

            }).join("");

        const overallDirection =
            buyPercent > 55
                ? "غلبة الشراء المبادر"
                : sellPercent > 55
                    ? "غلبة البيع المبادر"
                    : "توازن نسبي";

        results.innerHTML = `

            <div class="result-card">

                <h3>⚖️ تحليل نشاط الشراء والبيع</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${market.symbol}</strong>
                    </div>

                    <div>
                        <small>إجمالي التنفيذات</small>
                        <strong>${market.totalTrades.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>قيمة التداول</small>
                        <strong>${formatMoney(totalValue)}</strong>
                    </div>

                    <div>
                        <small>الفترات النشطة</small>
                        <strong>${activity.length}</strong>
                    </div>

                </div>

                <h4>توزيع ضغط المبادرة</h4>

                <div class="trade-summary">

                    <div>
                        <small>الشراء المبادر</small>
                        <strong class="buy">
                            ${buyPercent.toFixed(2)}%
                        </strong>
                        <small>${formatMoney(totalBuy)}</small>
                    </div>

                    <div>
                        <small>البيع المبادر</small>
                        <strong class="sell">
                            ${sellPercent.toFixed(2)}%
                        </strong>
                        <small>${formatMoney(totalSell)}</small>
                    </div>

                </div>

                <div style="
                    display:flex;
                    height:14px;
                    overflow:hidden;
                    border-radius:10px;
                    margin:15px 0;
                    background:#333;
                ">

                    <div style="
                        width:${buyPercent}%;
                        background:#16c784;
                    "></div>

                    <div style="
                        width:${sellPercent}%;
                        background:#ea3943;
                    "></div>

                </div>

                <h4>القراءة العامة</h4>

                <div class="analysis-note">
                    <strong>${overallDirection}</strong>
                    <p>
                        عدد التنفيذات الشرائية: ${buyCount.toLocaleString()}
                        <br>
                        عدد التنفيذات البيعية: ${sellCount.toLocaleString()}
                    </p>
                </div>

                <h4>أقوى دقيقة شراء</h4>

                <div class="analysis-note">
                    <strong>${formatMoney(strongestBuy.buyValue)}</strong>
                    <p>${formatTime(strongestBuy.time)}</p>
                </div>

                <h4>أقوى دقيقة بيع</h4>

                <div class="analysis-note">
                    <strong>${formatMoney(strongestSell.sellValue)}</strong>
                    <p>${formatTime(strongestSell.time)}</p>
                </div>

                <h4>تحولات ضغط المبادرة</h4>

                <div class="analysis-note">
                    عدد التحولات المرصودة:
                    <strong>${transitions.length}</strong>
                </div>

                <h4>النشاط الزمني الأخير</h4>

                ${activityRows}

                <p class="analysis-note">
                    تم تحليل ${market.totalTrades.toLocaleString()}
                    صفقة عبر ${market.pages} دفعات.
                    الفترات الزمنية مدتها دقيقة واحدة.
                    اتجاه المبادرة لا يعني بالضرورة تغير ملكية
                    رأس المال أو اتجاه السعر.
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
