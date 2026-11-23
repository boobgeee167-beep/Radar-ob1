
/**
 * WHALE RADAR
 * EXECUTION CLUSTERS DETECTOR
 *
 * اكتشاف تجمعات التنفيذ خلال فترات زمنية قصيرة.
 * تحليل اتجاه المبادرة، كثافة التنفيذ، والقيمة الإجمالية.
 */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🐋 محلل تجمعات التنفيذ</h3>
            <p>جارٍ تحليل تدفق الصفقات...</p>
        </div>
    `;

    try {

        const symbol = settings.symbol;

        const url = new URL(
            "https://data-api.binance.vision/api/v3/aggTrades"
        );

        url.searchParams.set("symbol", symbol);
        url.searchParams.set("limit", "1000");

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("تعذر الاتصال ببيانات Binance");
        }

        const rawTrades = await response.json();

        if (!Array.isArray(rawTrades) || rawTrades.length === 0) {
            throw new Error("لا توجد صفقات متاحة");
        }

        let trades = rawTrades.map(trade => ({
            price: Number(trade.p),
            quantity: Number(trade.q),
            value: Number(trade.p) * Number(trade.q),
            time: Number(trade.T),
            buyerIsMaker: trade.m
        }));

        // تطبيق الفترة الزمنية المخصصة
        if (
            settings.period === "custom" &&
            settings.startTime &&
            settings.endTime
        ) {

            trades = trades.filter(trade =>
                trade.time >= settings.startTime &&
                trade.time <= settings.endTime
            );

        }

        if (trades.length < 5) {
            throw new Error("عدد الصفقات غير كافٍ لاكتشاف التجمعات");
        }

        trades.sort((a, b) => a.time - b.time);

        // إعدادات التحليل
        const WINDOW_MS = 60 * 1000;
        const MIN_TRADES = 5;

        // إنشاء نوافذ زمنية متحركة
        const clusters = [];

        let left = 0;
        let buyValue = 0;
        let sellValue = 0;

        for (let right = 0; right < trades.length; right++) {

            const current = trades[right];

            if (current.buyerIsMaker) {
                sellValue += current.value;
            } else {
                buyValue += current.value;
            }

            while (
                current.time - trades[left].time > WINDOW_MS
            ) {

                if (trades[left].buyerIsMaker) {
                    sellValue -= trades[left].value;
                } else {
                    buyValue -= trades[left].value;
                }

                left++;

            }

            const count = right - left + 1;

            if (count < MIN_TRADES) continue;

            const totalValue = buyValue + sellValue;

            const buyRatio = totalValue
                ? buyValue / totalValue * 100
                : 0;

            const sellRatio = totalValue
                ? sellValue / totalValue * 100
                : 0;

            const direction =
                buyRatio >= 65
                    ? "شراء مبادر"
                    : sellRatio >= 65
                        ? "بيع مبادر"
                        : "نشاط مختلط";

            clusters.push({

                startTime: trades[left].time,
                endTime: current.time,

                count,

                buyValue,
                sellValue,
                totalValue,

                buyRatio,
                sellRatio,

                direction,

                firstPrice: trades[left].price,
                lastPrice: current.price

            });

        }

        // دمج النوافذ المتداخلة في تجمعات مستقلة
        const merged = [];

        for (const cluster of clusters) {

            const previous = merged[merged.length - 1];

            if (
                previous &&
                cluster.startTime <= previous.endTime
            ) {

                previous.endTime = Math.max(
                    previous.endTime,
                    cluster.endTime
                );

                previous.count = Math.max(
                    previous.count,
                    cluster.count
                );

                previous.buyValue = Math.max(
                    previous.buyValue,
                    cluster.buyValue
                );

                previous.sellValue = Math.max(
                    previous.sellValue,
                    cluster.sellValue
                );

                previous.totalValue =
                    previous.buyValue + previous.sellValue;

                previous.buyRatio = previous.totalValue
                    ? previous.buyValue / previous.totalValue * 100
                    : 0;

                previous.sellRatio = previous.totalValue
                    ? previous.sellValue / previous.totalValue * 100
                    : 0;

                previous.direction =
                    previous.buyRatio >= 65
                        ? "شراء مبادر"
                        : previous.sellRatio >= 65
                            ? "بيع مبادر"
                            : "نشاط مختلط";

                previous.lastPrice = cluster.lastPrice;

            } else {

                merged.push({ ...cluster });

            }

        }

        // ترتيب التجمعات حسب القيمة
        merged.sort((a, b) => b.totalValue - a.totalValue);

        const topClusters = merged.slice(0, 30);

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        const formatNumber = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        const clusterHTML = topClusters.map(cluster => {

            const duration =
                (cluster.endTime - cluster.startTime) / 1000;

            const priceChange =
                cluster.firstPrice
                    ? (
                        (cluster.lastPrice - cluster.firstPrice)
                        / cluster.firstPrice
                    ) * 100
                    : 0;

            const directionClass =
                cluster.direction === "شراء مبادر"
                    ? "buy"
                    : cluster.direction === "بيع مبادر"
                        ? "sell"
                        : "";

            return `

                <div class="trade-row">

                    <div>
                        <strong>${formatMoney(cluster.totalValue)}</strong>
                        <small>${cluster.count} تنفيذات ضمن النافذة</small>
                    </div>

                    <div>
                        <strong class="${directionClass}">
                            ${cluster.direction}
                        </strong>
                        <small>
                            شراء ${cluster.buyRatio.toFixed(1)}%
                            | بيع ${cluster.sellRatio.toFixed(1)}%
                        </small>
                    </div>

                    <div>
                        <strong>${duration.toFixed(1)} ثانية</strong>
                        <small>
                            تغير السعر ${priceChange.toFixed(3)}%
                        </small>
                    </div>

                    <div>
                        <small>البداية</small>
                        <strong>${formatTime(cluster.startTime)}</strong>
                        <small>النهاية</small>
                        <strong>${formatTime(cluster.endTime)}</strong>
                    </div>

                </div>

            `;

        }).join("");

        const totalClusterValue = merged.reduce(
            (sum, cluster) => sum + cluster.totalValue,
            0
        );

        const buyClusters = merged.filter(
            cluster => cluster.direction === "شراء مبادر"
        ).length;

        const sellClusters = merged.filter(
            cluster => cluster.direction === "بيع مبادر"
        ).length;

        const mixedClusters = merged.filter(
            cluster => cluster.direction === "نشاط مختلط"
        ).length;

        results.innerHTML = `

            <div class="result-card">

                <h3>🐋 نتائج تجمعات التنفيذ</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${symbol}</strong>
                    </div>

                    <div>
                        <small>الصفقات المحللة</small>
                        <strong>${trades.length}</strong>
                    </div>

                    <div>
                        <small>التجمعات المكتشفة</small>
                        <strong>${merged.length}</strong>
                    </div>

                    <div>
                        <small>قيمة التجمعات</small>
                        <strong>${formatMoney(totalClusterValue)}</strong>
                    </div>

                </div>

                <h4>توزيع التجمعات</h4>

                <div class="trade-summary">

                    <div>
                        <small>شراء مبادر</small>
                        <strong>${buyClusters}</strong>
                    </div>

                    <div>
                        <small>بيع مبادر</small>
                        <strong>${sellClusters}</strong>
                    </div>

                    <div>
                        <small>مختلط</small>
                        <strong>${mixedClusters}</strong>
                    </div>

                </div>

                <h4>أقوى التجمعات</h4>

                ${
                    clusterHTML ||
                    "<p>لم يتم اكتشاف تجمعات.</p>"
                }

                <p class="analysis-note">
                    التجمعات مبنية على نوافذ تنفيذ متحركة مدتها دقيقة.
                    النوافذ المتداخلة دُمجت لتجنب عرض النشاط نفسه مراراً.
                    التجمع لا يثبت أن الصفقات صادرة عن متداول واحد
                    أو خوارزمية واحدة.
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
