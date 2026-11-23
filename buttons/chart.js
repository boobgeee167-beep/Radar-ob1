
/**
 * WHALE RADAR
 * TradingView Chart Module
 * فتح الشارت في المتصفح الخارجي
 */

export async function run(settings) {

    const symbol = settings.symbol;

    const intervals = {
        "1h": "60",
        "4h": "240",
        "12h": "720",
        "custom": "60"
    };

    const interval = intervals[settings.period] || "60";

    const url = new URL("https://www.tradingview.com/chart/");

    url.searchParams.set("symbol", `BINANCE:${symbol}`);
    url.searchParams.set("interval", interval);

    // فتح صفحة الموقع في المتصفح الخارجي
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.openLink(url.href);
    } else {
        window.open(url.href, "_blank");
    }

}

