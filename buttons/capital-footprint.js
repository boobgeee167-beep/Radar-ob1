
/**
 * WHALE RADAR
 * CAPITAL FOOTPRINT ANALYZER
 *
 * تحليل مناطق تركّز التنفيذات الكبيرة.
 * تحديد مستويات الأسعار التي يتركز عندها رأس المال.
 * قياس اتجاه المبادرة الشرائية والبيعية.
 */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🐋 تحليل بصمة رأس المال</h3>
            <p>جارٍ بناء خريطة نشاط رأس المال الكبير...</p>
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

        if (trades.length < 10) {
            throw new Error("البيانات غير كافية لبناء البصمة");
        }

        trades.sort((a, b) => a.time - b.time);

        // تحديد الحد النسبي للنشاط الكبير
        const values = trades.map(trade => trade.value);

        const sortedValues = [...values].sort((a, b) => a - b);

        const percentileIndex = Math.floor(
            (sortedValues.length - 1) * 0.90
        );

        const largeThreshold = sortedValues[percentileIndex];

        const largeTrades = trades.filter(
            trade => trade.value >= largeThreshold
        );

        if (!largeTrades.length) {
            throw new Error("لم يتم العثور على تنفيذات كبيرة");
        }

        // تحديد نطاق الأسعار
        const minPrice = Math.min(
            ...largeTrades.map(trade => trade.price)
        );

        const maxPrice = Math.max(
            ...largeTrades.map(trade => trade.price)
        );

        const range = maxPrice - minPrice;

        const bucketCount = 20;

        const bucketSize = range > 0
            ? range / bucketCount
            : Math.max(minPrice * 0.0001, Number.EPSILON);

        const buckets = Array.from(
            { length: bucketCount },
            (_, index) => ({
                index,
                low: minPrice + index * bucketSize,
                high: minPrice + (index + 1) * bucketSize,
                totalValue: 0,
                buyValue: 0,
                sellValue: 0,
                count: 0,
                quantity: 0
            })
        );

        // توزيع الصفقات على مستويات الأسعار
        for (const trade of largeTrades) {

            let index = range > 0
                ? Math.floor((trade.price - minPrice) / bucketSize)
                : 0;

            index = Math.min(
                bucketCount - 1,
                Math.max(0, index)
            );

            const bucket = buckets[index];

            bucket.totalValue += trade.value;
            bucket.quantity += trade.quantity;
            bucket.count++;

            if (trade.buyerIsMaker) {
                bucket.sellValue += trade.value;
            } else {
                bucket.buyValue += trade.value;
            }

        }

        const activeBuckets = buckets
            .filter(bucket => bucket.count > 0)
            .map(bucket => ({

                ...bucket,

                center: (bucket.low + bucket.high) / 2,

                buyRatio: bucket.totalValue
                    ? bucket.buyValue / bucket.totalValue * 100
                    : 0,

                sellRatio: bucket.totalValue
                    ? bucket.sellValue / bucket.totalValue * 100
                    : 0

            }))
            .sort((a, b) => b.totalValue - a.totalValue);

        // حساب إجمالي النشاط
        const totalCapital = largeTrades.reduce(
            (sum, trade) => sum + trade.value,
            0
        );

        const totalBuy = largeTrades
            .filter(trade => !trade.buyerIsMaker)
            .reduce((sum, trade) => sum + trade.value, 0);

        const totalSell = largeTrades
            .filter(trade => trade.buyerIsMaker)
            .reduce((sum, trade) => sum + trade.value, 0);

        const buyRatio = totalCapital
            ? totalBuy / totalCapital * 100
            : 0;

        const sellRatio = totalCapital
            ? totalSell / totalCapital * 100
            : 0;

        // تحديد منطقة تركّز رأس المال
        const strongestZone = activeBuckets[0];

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatPrice = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        // عرض خريطة البصمة
        const footprintHTML = activeBuckets
            .slice(0, 15)
            .map(bucket => {

                const direction =
                    bucket.buyRatio >= 65
                        ? "شراء غالب"
                        : bucket.sellRatio >= 65
                            ? "بيع غالب"
                            : "نشاط مختلط";

                const directionClass =
                    bucket.buyRatio >= 65
                        ? "buy"
                        : bucket.sellRatio >= 65
                            ? "sell"
                            : "";

                return `

                    <div class="trade-row">

                        <div>
                            <strong>
                                ${formatPrice(bucket.low)}
                                -
                                ${formatPrice(bucket.high)}
                            </strong>

                            <small>${bucket.count} تنفيذات كبيرة</small>
                        </div>

                        <div>
                            <strong>${formatMoney(bucket.totalValue)}</strong>
                            <small>${formatPrice(bucket.quantity)} كمية</small>
                        </div>

                        <div>
                            <strong class="${directionClass}">
                                ${direction}
                            </strong>

                            <small>
                                شراء ${bucket.buyRatio.toFixed(1)}%
                                | بيع ${bucket.sellRatio.toFixed(1)}%
                            </small>
                        </div>

                    </div>

                `;

            }).join("");

        // قياس انتشار النشاط بين المستويات
        const activeLevelCount = activeBuckets.length;

        const dominantRatio = totalCapital
            ? strongestZone.totalValue / totalCapital * 100
            : 0;

        const marketBias =
            buyRatio >= 60
                ? "ميل شرائي في التنفيذات الكبيرة"
                : sellRatio >= 60
                    ? "ميل بيعي في التنفيذات الكبيرة"
                    : "نشاط متوازن نسبياً";

        results.innerHTML = `

            <div class="result-card">

                <h3>🐋 بصمة نشاط رأس المال الكبير</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${symbol}</strong>
                    </div>

                    <div>
                        <small>التنفيذات الكبيرة</small>
                        <strong>${largeTrades.length}</strong>
                    </div>

                    <div>
                        <small>المستويات النشطة</small>
                        <strong>${activeLevelCount}</strong>
                    </div>

                    <div>
                        <small>قيمة النشاط الكبير</small>
                        <strong>${formatMoney(totalCapital)}</strong>
                    </div>

                </div>

                <h4>اتجاه المبادرة</h4>

                <div class="trade-summary">

                    <div>
                        <small>شراء مبادر</small>
                        <strong>${buyRatio.toFixed(2)}%</strong>
                    </div>

                    <div>
                        <small>بيع مبادر</small>
                        <strong>${sellRatio.toFixed(2)}%</strong>
                    </div>

                    <div>
                        <small>القراءة</small>
                        <strong>${marketBias}</strong>
                    </div>

                </div>

                <h4>أقوى منطقة تركّز</h4>

                <div class="trade-summary">

                    <div>
                        <small>النطاق السعري</small>

                        <strong>
                            ${formatPrice(strongestZone.low)}
                            -
                            ${formatPrice(strongestZone.high)}
                        </strong>
                    </div>

                    <div>
                        <small>قيمة النشاط</small>
                        <strong>${formatMoney(strongestZone.totalValue)}</strong>
                    </div>

                    <div>
                        <small>نسبة النشاط</small>
                        <strong>${dominantRatio.toFixed(2)}%</strong>
                    </div>

                </div>

                <h4>خريطة مستويات رأس المال</h4>

                ${footprintHTML}

                <p class="analysis-note">
                    تعتمد هذه البصمة على أعلى 10% من قيم التنفيذات
                    داخل العينة الحالية، ثم توزيعها على مستويات سعرية.
                    وهي تقيس تركّز نشاط التنفيذ، لا ملكية المحافظ
                    ولا صافي التجميع الحقيقي.
                    لا يمكن استنتاج أن جهة واحدة تقف خلف هذه العمليات.
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
