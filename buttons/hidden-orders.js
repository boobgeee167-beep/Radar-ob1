
/**
 * WHALE RADAR
 * HIDDEN ORDERS PATTERN DETECTOR
 *
 * رصد أنماط التنفيذ التي قد تشير إلى:
 * - Iceberg محتمل
 * - تجزئة الأوامر الكبيرة
 * - امتصاص ضغط البيع أو الشراء
 * - تكرار التنفيذ عند مستوى سعري واحد
 *
 * لا يدّعي إثبات وجود أوامر مخفية.
 */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🔬 كاشف الأنماط المخفية</h3>
            <p>جارٍ تحليل بصمات التنفيذ ودفتر الأوامر...</p>
        </div>
    `;

    try {

        const symbol = settings.symbol;

        if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
            throw new Error("رمز العملة غير صالح");
        }

        // جلب الصفقات المجمعة
        const tradesURL = new URL(
            "https://data-api.binance.vision/api/v3/aggTrades"
        );

        tradesURL.searchParams.set("symbol", symbol);
        tradesURL.searchParams.set("limit", "1000");

        // جلب دفتر الأوامر الحالي
        const depthURL = new URL(
            "https://data-api.binance.vision/api/v3/depth"
        );

        depthURL.searchParams.set("symbol", symbol);
        depthURL.searchParams.set("limit", "1000");

        const [tradesResponse, depthResponse] = await Promise.all([
            fetch(tradesURL),
            fetch(depthURL)
        ]);

        if (!tradesResponse.ok || !depthResponse.ok) {
            throw new Error("تعذر جلب بيانات Binance");
        }

        const [rawTrades, depth] = await Promise.all([
            tradesResponse.json(),
            depthResponse.json()
        ]);

        if (!Array.isArray(rawTrades) || !rawTrades.length) {
            throw new Error("لا توجد صفقات متاحة للتحليل");
        }

        if (!Array.isArray(depth.bids) || !Array.isArray(depth.asks)) {
            throw new Error("بيانات دفتر الأوامر غير مكتملة");
        }

        // مراعاة الفترة الزمنية المخصصة إن وجدت
        let trades = rawTrades;

        if (
            settings.period === "custom" &&
            settings.startTime &&
            settings.endTime
        ) {
            trades = trades.filter(trade =>
                Number(trade.T) >= settings.startTime &&
                Number(trade.T) <= settings.endTime
            );
        }

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة في العينة");
        }

        const analyzed = trades.map(trade => ({
            price: Number(trade.p),
            quantity: Number(trade.q),
            value: Number(trade.p) * Number(trade.q),
            time: Number(trade.T),
            buyerIsMaker: trade.m
        }));

        const totalVolume = analyzed.reduce(
            (sum, trade) => sum + trade.quantity, 0
        );

        const totalValue = analyzed.reduce(
            (sum, trade) => sum + trade.value, 0
        );

        // تجميع التنفيذات حسب السعر
        const levels = new Map();

        for (const trade of analyzed) {

            const key = trade.price.toString();

            if (!levels.has(key)) {
                levels.set(key, {
                    price: trade.price,
                    count: 0,
                    quantity: 0,
                    value: 0,
                    buyInitiated: 0,
                    sellInitiated: 0,
                    firstTime: trade.time,
                    lastTime: trade.time
                });
            }

            const level = levels.get(key);

            level.count++;
            level.quantity += trade.quantity;
            level.value += trade.value;

            if (trade.buyerIsMaker) {
                level.sellInitiated += trade.quantity;
            } else {
                level.buyInitiated += trade.quantity;
            }

            level.firstTime = Math.min(level.firstTime, trade.time);
            level.lastTime = Math.max(level.lastTime, trade.time);
        }

        const groupedLevels = [...levels.values()];

        // متوسط قيمة التنفيذ
        const averageValue = totalValue / analyzed.length;

        // مستويات تكرار التنفيذ
        const repeatedLevels = groupedLevels
            .filter(level => level.count >= 4)
            .sort((a, b) => b.value - a.value);

        // مستويات ذات تنفيذ مرتفع مقارنة بالعينة
        const heavyLevels = groupedLevels
            .filter(level =>
                level.value >= averageValue * 5 &&
                level.count >= 2
            )
            .sort((a, b) => b.value - a.value);

        // تحليل دفتر الأوامر الحالي
        const bids = depth.bids.map(item => ({
            price: Number(item[0]),
            quantity: Number(item[1]),
            value: Number(item[0]) * Number(item[1])
        }));

        const asks = depth.asks.map(item => ({
            price: Number(item[0]),
            quantity: Number(item[1]),
            value: Number(item[0]) * Number(item[1])
        }));

        const findBookLevel = (price, side) => {

            const list = side === "bid" ? bids : asks;

            return list.find(item => item.price === price) || null;

        };

        // مقارنة التنفيذات مع السيولة الظاهرة حالياً
        const bookComparisons = heavyLevels.map(level => {

            const bid = findBookLevel(level.price, "bid");
            const ask = findBookLevel(level.price, "ask");

            const displayed = bid || ask;

            return {
                ...level,
                displayedQuantity: displayed
                    ? displayed.quantity
                    : null,
                displayedValue: displayed
                    ? displayed.value
                    : null
            };

        });

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatNumber = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        // بناء تقرير مستويات التكرار
        const repeatedHTML = repeatedLevels
            .slice(0, 15)
            .map(level => {

                const duration =
                    (level.lastTime - level.firstTime) / 1000;

                return `
                    <div class="trade-row">
                        <div>
                            <strong>${formatNumber(level.price)}</strong>
                            <small>${level.count} تنفيذات مجمعة</small>
                        </div>

                        <div>
                            <strong>${formatMoney(level.value)}</strong>
                            <small>${formatNumber(level.quantity)} كمية</small>
                        </div>

                        <div>
                            <small>الفاصل الزمني</small>
                            <strong>${duration.toFixed(1)} ثانية</strong>
                        </div>
                    </div>
                `;

            }).join("");

        // بناء تقرير مستويات التنفيذ المرتفع
        const heavyHTML = bookComparisons
            .slice(0, 15)
            .map(level => {

                const side = level.buyInitiated >= level.sellInitiated
                    ? "شراء مبادر"
                    : "بيع مبادر";

                return `
                    <div class="trade-row">
                        <div>
                            <strong>${formatNumber(level.price)}</strong>
                            <small>${side}</small>
                        </div>

                        <div>
                            <strong>${formatMoney(level.value)}</strong>
                            <small>${level.count} تنفيذات مجمعة</small>
                        </div>

                        <div>
                            <small>السيولة الظاهرة الآن</small>
                            <strong>
                                ${
                                    level.displayedValue === null
                                    ? "غير موجودة حالياً"
                                    : formatMoney(level.displayedValue)
                                }
                            </strong>
                        </div>
                    </div>
                `;

            }).join("");

        // حساب ضغط المبادرة
        const buyInitiated = analyzed
            .filter(trade => !trade.buyerIsMaker)
            .reduce((sum, trade) => sum + trade.value, 0);

        const sellInitiated = analyzed
            .filter(trade => trade.buyerIsMaker)
            .reduce((sum, trade) => sum + trade.value, 0);

        const buyRatio = totalValue
            ? buyInitiated / totalValue * 100
            : 0;

        const sellRatio = totalValue
            ? sellInitiated / totalValue * 100
            : 0;

        results.innerHTML = `

            <div class="result-card">

                <h3>🔬 تحليل أنماط الأوامر المخفية</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${symbol}</strong>
                    </div>

                    <div>
                        <small>التنفيذات المحللة</small>
                        <strong>${analyzed.length}</strong>
                    </div>

                    <div>
                        <small>مستويات التكرار</small>
                        <strong>${repeatedLevels.length}</strong>
                    </div>

                    <div>
                        <small>مستويات التنفيذ المرتفع</small>
                        <strong>${heavyLevels.length}</strong>
                    </div>

                </div>

                <h4>1. مستويات تكرار التنفيذ</h4>

                ${
                    repeatedHTML ||
                    "<p>لم تظهر مستويات تحقق شروط التكرار.</p>"
                }

                <h4>2. التنفيذات المرتفعة والسيولة الظاهرة</h4>

                ${
                    heavyHTML ||
                    "<p>لم تظهر مستويات تحقق شروط التنفيذ المرتفع.</p>"
                }

                <h4>3. ضغط المبادرة</h4>

                <div class="trade-summary">

                    <div>
                        <small>شراء مبادر</small>
                        <strong>${buyRatio.toFixed(2)}%</strong>
                    </div>

                    <div>
                        <small>بيع مبادر</small>
                        <strong>${sellRatio.toFixed(2)}%</strong>
                    </div>

                </div>

                <h4>4. قراءة الرادار</h4>

                <p>
                    ${
                        repeatedLevels.length
                        ? "ظهرت مستويات سعرية تكرر عندها التنفيذ. تستحق هذه المستويات مراقبة إضافية."
                        : "لم تظهر مستويات تكرار واضحة في العينة."
                    }
                </p>

                <p class="analysis-note">
                    تنبيه: تكرار التنفيذ عند سعر واحد لا يثبت وجود
                    Iceberg أو أمر مخفي. كما أن دفتر الأوامر يمثل
                    لقطة حالية، ولا يثبت تجدد السيولة تاريخياً.
                    بيانات Binance العامة لا تكشف هوية أصحاب الأوامر.
                    هذه النتائج مؤشرات أولية وليست إثباتاً.
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
  
