
/**
 * WHALE RADAR
 * EXECUTION CLUSTERS
 * Central Data Engine Edition
 */

import { fetchMarketData } from "../core/market-data.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🔬 رادار تجمعات التنفيذ</h3>
            <p>جارٍ البحث عن فترات النشاط المكثف...</p>
        </div>
    `;

    try {

        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        // إعداد نافذة التجميع
        const WINDOW_MS = 60 * 1000;

        const MIN_TRADES = 5;

        const MIN_VALUE = 0;

        const sorted = [...trades].sort(
            (a, b) => a.time - b.time || a.id - b.id
        );

        // إنشاء النوافذ الزمنية
        const windows = [];

        let current = null;

        for (const trade of sorted) {

            const windowStart =
                Math.floor(trade.time / WINDOW_MS) * WINDOW_MS;

            if (!current || current.start !== windowStart) {

                current = {
                    start: windowStart,
                    end: windowStart + WINDOW_MS,
                    trades: []
                };

                windows.push(current);
            }

            current.trades.push(trade);
        }

        // الاحتفاظ بالنوافذ النشطة
        const activeWindows = windows.filter(window => {

            const value = window.trades.reduce(
                (sum, trade) => sum + trade.value,
                0
            );

            return (
                window.trades.length >= MIN_TRADES &&
                value >= MIN_VALUE
            );

        });

        // دمج النوافذ النشطة المتجاورة
        const clusters = [];

        for (const window of activeWindows) {

            const last = clusters[clusters.length - 1];

            if (last && window.start <= last.end) {

                last.end = window.end;
                last.windows.push(window);

            } else {

                clusters.push({
                    start: window.start,
                    end: window.end,
                    windows: [window]
                });

            }

        }

        // إعادة حساب كل تجمع من صفقاته الفعلية
        const analyzedClusters = clusters.map(cluster => {

            const clusterTrades = cluster.windows
                .flatMap(window => window.trades);

            const buyTrades = clusterTrades.filter(
                trade => !trade.buyerIsMaker
            );

            const sellTrades = clusterTrades.filter(
                trade => trade.buyerIsMaker
            );

            const buyValue = buyTrades.reduce(
                (sum, trade) => sum + trade.value,
                0
            );

            const sellValue = sellTrades.reduce(
                (sum, trade) => sum + trade.value,
                0
            );

            const totalValue = buyValue + sellValue;

            const firstPrice = clusterTrades[0].price;

            const lastPrice =
                clusterTrades[clusterTrades.length - 1].price;

            const priceChange =
                ((lastPrice - firstPrice) / firstPrice) * 100;

            let direction = "متوازن";

            if (buyValue > sellValue * 1.2) {
                direction = "شراء مبادر";
            } else if (sellValue > buyValue * 1.2) {
                direction = "بيع مبادر";
            }

            return {

                start: cluster.start,

                end: cluster.end,

                duration:
                    (cluster.end - cluster.start) / 1000,

                tradeCount: clusterTrades.length,

                buyValue,

                sellValue,

                totalValue,

                priceChange,

                direction

            };

        });

        analyzedClusters.sort(
            (a, b) => b.totalValue - a.totalValue
        );

        const totalClusterValue = analyzedClusters.reduce(
            (sum, cluster) => sum + cluster.totalValue,
            0
        );

        const totalBuy = analyzedClusters.reduce(
            (sum, cluster) => sum + cluster.buyValue,
            0
        );

        const totalSell = analyzedClusters.reduce(
            (sum, cluster) => sum + cluster.sellValue,
            0
        );

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        const formatPercent = value =>
            (value > 0 ? "+" : "") +
            value.toFixed(3) + "%";

        const rows = analyzedClusters
            .slice(0, 30)
            .map((cluster, index) => {

                const directionClass =
                    cluster.direction === "شراء مبادر"
                        ? "buy"
                        : cluster.direction === "بيع مبادر"
                            ? "sell"
                            : "";

                return `
                    <div class="trade-row">

                        <div>
                            <strong>التجمع ${index + 1}</strong>
                            <small>${formatTime(cluster.start)}</small>
                        </div>

                        <div>
                            <strong>${formatMoney(cluster.totalValue)}</strong>
                            <small>${cluster.tradeCount} تنفيذ</small>
                        </div>

                        <div>
                            <strong class="${directionClass}">
                                ${cluster.direction}
                            </strong>
                            <small>${formatPercent(cluster.priceChange)}</small>
                        </div>

                    </div>
                `;

            }).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>🔬 تحليل تجمعات التنفيذ</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${market.symbol}</strong>
                    </div>

                    <div>
                        <small>إجمالي الصفقات</small>
                        <strong>${market.totalTrades.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>عدد التجمعات</small>
                        <strong>${analyzedClusters.length}</strong>
                    </div>

                    <div>
                        <small>قيمة التجمعات</small>
                        <strong>${formatMoney(totalClusterValue)}</strong>
                    </div>

                </div>

                <h4>اتجاه المبادرة داخل التجمعات</h4>

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

                <h4>أقوى تجمعات النشاط</h4>

                ${
                    rows ||
                    "<p>لم يتم العثور على تجمعات تستوفي شروط الرصد.</p>"
                }

                <p class="analysis-note">
                    تم تحليل ${market.totalTrades.toLocaleString()}
                    صفقة عبر ${market.pages} دفعات.
                    التجمعات مبنية على نوافذ دقيقة متجاورة تحتوي
                    على خمسة تنفيذات أو أكثر.
                    اتجاه المبادرة يعبر عن الطرف الذي بدأ التنفيذ،
                    ولا يثبت وجود جهة واحدة أو خوارزمية محددة.
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
