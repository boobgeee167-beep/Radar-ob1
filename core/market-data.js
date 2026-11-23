
/**
 * WHALE RADAR
 * CENTRAL MARKET DATA ENGINE
 *
 * محرك مركزي لجلب جميع الصفقات المجمعة
 * ضمن الفترة الزمنية المطلوبة من Binance Spot.
 */

const API = "https://data-api.binance.vision/api/v3/aggTrades";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10000;


/* تحديد الفترة الزمنية */

function getTimeRange(settings) {

    const now = Date.now();

    if (settings.period === "custom") {

        const startTime = Number(settings.startTime);
        const endTime = Number(settings.endTime);

        if (
            !Number.isFinite(startTime) ||
            !Number.isFinite(endTime) ||
            startTime >= endTime ||
            endTime > now
        ) {
            throw new Error("الفترة الزمنية المخصصة غير صحيحة");
        }

        return { startTime, endTime };
    }

    const durations = {
        "1h": 60 * 60 * 1000,
        "4h": 4 * 60 * 60 * 1000,
        "12h": 12 * 60 * 60 * 1000
    };

    const duration = durations[settings.period];

    if (!duration) {
        throw new Error("الفترة الزمنية غير مدعومة");
    }

    return {
        startTime: now - duration,
        endTime: now
    };
}


/* طلب بيانات Binance مع إعادة المحاولة */

async function requestTrades(params) {

    const url = new URL(API);

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt < 4; attempt++) {

        const response = await fetch(url);

        if (response.ok) {
            return await response.json();
        }

        if (
            response.status === 429 ||
            response.status === 418 ||
            response.status >= 500
        ) {

            if (attempt === 3) {
                throw new Error(
                    `تعذر جلب بيانات Binance: ${response.status}`
                );
            }

            const retryAfter = Number(
                response.headers.get("Retry-After")
            );

            const delay = Number.isFinite(retryAfter) &&
                retryAfter > 0
                ? retryAfter * 1000
                : 1000 * (attempt + 1);

            await new Promise(resolve =>
                setTimeout(resolve, delay)
            );

            continue;
        }

        throw new Error(
            `خطأ من Binance: ${response.status}`
        );
    }

    throw new Error("فشل الاتصال ببيانات السوق");
}


/* جلب جميع الصفقات ضمن الفترة */

export async function fetchMarketData(settings) {

    if (!settings?.symbol) {
        throw new Error("رمز العملة غير محدد");
    }

    const symbol = settings.symbol.toUpperCase();

    if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
        throw new Error("رمز العملة غير صالح");
    }

    const { startTime, endTime } = getTimeRange(settings);

    // البحث عن أول صفقة في الفترة
    const firstPage = await requestTrades({
        symbol,
        startTime,
        endTime,
        limit: 1
    });

    if (!Array.isArray(firstPage)) {
        throw new Error("استجابة Binance غير صالحة");
    }

    if (firstPage.length === 0) {

        return {
            symbol,
            startTime,
            endTime,
            trades: [],
            totalTrades: 0,
            pages: 1,
            complete: true
        };
    }

    const trades = [];

    let nextId = Number(firstPage[0].a);
    let pages = 0;
    let finished = false;

    // متابعة الصفقات باستخدام معرف التنفيذ
    while (!finished) {

        if (pages >= MAX_PAGES) {
            throw new Error(
                "الفترة كبيرة جداً. أوقفنا الجلب لحماية المتصفح."
            );
        }

        const page = await requestTrades({
            symbol,
            fromId: nextId,
            limit: PAGE_SIZE
        });

        pages++;

        if (!Array.isArray(page)) {
            throw new Error("بيانات الصفقات غير صالحة");
        }

        if (page.length === 0) {
            finished = true;
            break;
        }

        for (const trade of page) {

            const time = Number(trade.T);

            if (time > endTime) {
                finished = true;
                break;
            }

            if (time < startTime) {
                continue;
            }

            trades.push({

                id: Number(trade.a),

                price: Number(trade.p),

                quantity: Number(trade.q),

                value: Number(trade.p) * Number(trade.q),

                time,

                buyerIsMaker: trade.m

            });

        }

        const lastId = Number(page[page.length - 1].a);

        if (!Number.isFinite(lastId) || lastId < nextId) {
            throw new Error("تعذر متابعة صفحات الصفقات");
        }

        nextId = lastId + 1;

        if (page.length < PAGE_SIZE) {
            finished = true;
        }

    }

    trades.sort((a, b) => a.time - b.time || a.id - b.id);

    return {

        symbol,

        startTime,

        endTime,

        trades,

        totalTrades: trades.length,

        pages,

        complete: true

    };

}
