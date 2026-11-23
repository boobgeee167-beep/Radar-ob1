
/**
 * WHALE RADAR
 * STRATEGY CONFIRMATION
 *
 * واجهة المحلل الاستراتيجي المتوافقة مع
 * WHALE RADAR STRATEGY INTELLIGENCE ENGINE.
 *
 * أربعة مصادر تاريخية:
 * 1. الصفقات الضخمة
 * 2. عناقيد التنفيذ
 * 3. بصمة رأس المال
 * 4. نشاط الشراء والبيع
 *
 * لا يستخدم دفتر الأوامر اللحظي.
 */

import { analyzeStrategy } from "../core/strategy-engine.js";
import { renderDashboard } from "../core/results-ui.js";


/* =====================================
   FORMATTING
===================================== */

const formatMoney = value =>
    "$" + Number(value || 0).toLocaleString("en-US", {
        maximumFractionDigits: 2
    });

const formatPrice = value =>
    Number(value || 0).toLocaleString("en-US", {
        maximumFractionDigits: 10
    });

const formatNumber = value =>
    Number(value || 0).toLocaleString("en-US");

const formatPercent = value =>
    Number(value || 0).toFixed(2) + "%";

const formatTime = timestamp => {
    if (!timestamp) return "غير متاح";

    return new Date(timestamp).toLocaleString("ar", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
};

const directionName = direction =>
    direction === "long" ? "شراء LONG" : "بيع SHORT";

const escapeHTML = value =>
    String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);

const safeArray = value =>
    Array.isArray(value) ? value : [];

const safeValue = value =>
    Number.isFinite(Number(value)) ? Number(value) : 0;


/* =====================================
   VERDICT
===================================== */

function getVerdictTone(evaluation) {
    if (!evaluation) return "gold";

    if (evaluation.tone) return evaluation.tone;

    switch (evaluation.verdict) {
        case "support":
            return "buy";

        case "oppose":
            return "sell";

        default:
            return "gold";
    }
}

function getVerdictTitle(evaluation) {
    if (!evaluation) {
        return "الحكم الاستراتيجي غير متاح";
    }

    return evaluation.title || "لا يوجد حكم واضح";
}

function normalizeReasons(evaluation) {
    return safeArray(evaluation?.reasons)
        .map(reason => {
            if (typeof reason === "string") return reason;

            if (reason && typeof reason === "object") {
                return reason.text ||
                    reason.explanation ||
                    reason.title ||
                    "";
            }

            return "";
        })
        .filter(Boolean);
}

function buildStrategyVerdictSection(evaluation) {
    if (!evaluation) {
        return {
            type: "note",
            title: "الحكم الاستراتيجي",
            text: "لم يُرجع المحرك حكماً استراتيجياً."
        };
    }

    const reasons = normalizeReasons(evaluation);

    const reasonText = reasons.length
        ? "\n\nالأسباب:\n" +
          reasons.map((reason, index) =>
              `${index + 1}. ${reason}`
          ).join("\n")
        : "";

    return {
        type: "note",
        title: "الحكم الاستراتيجي للمحلل",
        text:
            `${getVerdictTitle(evaluation)}\n\n` +
            `${evaluation.explanation || ""}` +
            reasonText +
            "\n\nهذا تقييم استشاري للأدلة المرصودة، وليس أمراً بالدخول أو الامتناع عن الصفقة."
    };
}


/* =====================================
   FLOW ANALYSIS
===================================== */

function analyzeDirectionalFlow(data, direction) {
    const buyValue = safeValue(data?.buyValue);
    const sellValue = safeValue(data?.sellValue);
    const total = buyValue + sellValue;

    const count = safeValue(data?.totalCount) ||
        safeValue(data?.count) ||
        safeValue(data?.buyCount) + safeValue(data?.sellCount);

    if (!total || count < 2) {
        return {
            status: "بيانات محدودة",
            tone: "gold",
            share: null,
            explanation:
                "العينة لا تكفي لتكوين قراءة اتجاهية موثوقة."
        };
    }

    const buyShare = buyValue / total * 100;
    const sellShare = sellValue / total * 100;

    const supportingShare =
        direction === "long" ? buyShare : sellShare;

    const opposingShare =
        direction === "long" ? sellShare : buyShare;

    if (supportingShare >= 60) {
        return {
            status: "ميل مبادرة مؤيد",
            tone: "buy",
            share: supportingShare,
            explanation:
                `بلغت حصة المبادرة في اتجاه الصفقة ${formatPercent(supportingShare)}.`
        };
    }

    if (opposingShare >= 60) {
        return {
            status: "ميل مبادرة معاكس",
            tone: "sell",
            share: opposingShare,
            explanation:
                `بلغت حصة المبادرة المعاكسة ${formatPercent(opposingShare)}.`
        };
    }

    return {
        status: "مبادرة متقاربة",
        tone: "gold",
        share: supportingShare,
        explanation:
            "توزيع قيمة المبادرة بين الشراء والبيع متقارب نسبياً."
    };
}


/* =====================================
   PRICE RESPONSE
===================================== */

function buildResponseSection(layer, title) {
    const response = layer?.priceResponse;

    if (!response) {
        return {
            type: "note",
            title,
            text: "لا تتوفر بيانات كافية لتحليل استجابة السعر."
        };
    }

    const counts = response.behaviorCounts || {};

    return {
        type: "table",
        title,
        description: response.summary || "ملخص استجابة السعر للمبادرة.",
        columns: ["السلوك المرصود", "عدد النوافذ"],
        rows: [
            [
                "شراء مبادر مع صعود",
                formatNumber(counts.effectiveBuy)
            ],
            [
                "بيع مبادر مع هبوط",
                formatNumber(counts.effectiveSell)
            ],
            [
                "شراء دون صعود متناسب",
                formatNumber(counts.possibleSupply)
            ],
            [
                "بيع دون هبوط متناسب",
                formatNumber(counts.possibleDemand)
            ],
            [
                "متوازن أو غير حاسم",
                formatNumber(counts.balanced)
            ]
        ]
    };
}


/* =====================================
   LAYER DETAILS
===================================== */

function buildLayerSections(layer, title) {
    if (!layer) return [];

    const large = layer.largeTrades || {};
    const clusters = layer.clusters || {};
    const capital = layer.capital || {};
    const activity = layer.activity || {};
    const flow = layer.flow || {};

    return [
        {
            type: "note",
            title: `${title} — حجم التداول`,
            text:
                `عدد التنفيذات: ${formatNumber(layer.range?.count)}.\n` +
                `قيمة الشراء المبادر: ${formatMoney(flow.buyValue)}.\n` +
                `قيمة البيع المبادر: ${formatMoney(flow.sellValue)}.\n` +
                `التغير بين أول وآخر سعر في العينة: ${formatPercent(layer.range?.changePct)}.`
        },

        {
            type: "table",
            title: `${title} — الصفقات الضخمة`,
            columns: ["المقياس", "القيمة"],
            rows: [
                ["عدد التنفيذات", formatNumber(large.count)],
                ["قيمة التنفيذات", formatMoney(large.totalValue)],
                ["شراء مبادر", formatMoney(large.buyValue)],
                ["بيع مبادر", formatMoney(large.sellValue)],
                ["أكبر تنفيذ", formatMoney(large.largestTrade)],
                ["عتبة التصنيف", formatMoney(large.threshold)]
            ]
        },

        {
            type: "table",
            title: `${title} — عناقيد التنفيذ`,
            columns: ["المقياس", "القيمة"],
            rows: [
                ["النوافذ النشطة", formatNumber(clusters.activeWindows)],
                ["العناقيد الكثيفة", formatNumber(clusters.count)],
                ["عناقيد مائلة للشراء", formatNumber(clusters.buyCount)],
                ["عناقيد مائلة للبيع", formatNumber(clusters.sellCount)],
                ["قيمة الشراء", formatMoney(clusters.buyValue)],
                ["قيمة البيع", formatMoney(clusters.sellValue)]
            ]
        },

        {
            type: "table",
            title: `${title} — بصمة رأس المال`,
            columns: ["المقياس", "القيمة"],
            rows: [
                ["عدد التنفيذات", formatNumber(capital.count)],
                ["إجمالي القيمة", formatMoney(capital.totalValue)],
                ["قيمة الشراء", formatMoney(capital.buyValue)],
                ["قيمة البيع", formatMoney(capital.sellValue)],
                ["متوسط التنفيذ", formatMoney(capital.averageValue)],
                ["أكبر تنفيذ", formatMoney(capital.largestTrade)]
            ]
        },

        {
            type: "note",
            title: `${title} — نشاط الشراء والبيع`,
            text:
                `عدد التنفيذات: ${formatNumber(activity.totalCount)}.\n` +
                `نوافذ النشاط: ${formatNumber(activity.activeWindows)}.\n` +
                `نوافذ غلبة الشراء: ${formatNumber(activity.buyDominantWindows)}.\n` +
                `نوافذ غلبة البيع: ${formatNumber(activity.sellDominantWindows)}.\n` +
                `قيمة الشراء: ${formatMoney(activity.buyValue)}.\n` +
                `قيمة البيع: ${formatMoney(activity.sellValue)}.`
        },

        buildResponseSection(
            layer,
            `${title} — استجابة السعر للمبادرة`
        )
    ];
}


/* =====================================
   FINDINGS
===================================== */

function buildFindingsSections(findings) {
    return safeArray(findings).map(finding => ({
        type: "note",
        title: finding.name || "نتيجة تحليل",
        text: finding.text || "لا يوجد تفسير إضافي."
    }));
}


/* =====================================
   TIMELINE
===================================== */

function buildTimelineRows(layer) {
    const windows = safeArray(layer?.activity?.windows);

    return windows
        .slice(-15)
        .reverse()
        .map((window, index) => [
            `#${index + 1}`,
            formatTime(window.startTime),
            formatMoney(window.buyValue),
            formatMoney(window.sellValue),
            window.buyValue > window.sellValue
                ? "شراء"
                : window.sellValue > window.buyValue
                    ? "بيع"
                    : "متوازن"
        ]);
}


/* =====================================
   RUN
===================================== */

export async function run(settings) {
    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🧠 المحلل الاستراتيجي</h3>
            <p>جارٍ تحليل منطقة Order Block...</p>
            <p>يتم فحص بصمة التنفيذات واستجابة السعر.</p>
        </div>
    `;

    try {
        const data = await analyzeStrategy(settings);

        const {
            market,
            strategy,
            referencePrice,
            position,
            scenario,
            evaluation,
            evidence,
            dataQuality,
            limitations
        } = data;

        const globalLayer = evidence.global;
        const approachLayer = evidence.approach;
        const zoneLayer = evidence.zone;

        const direction = strategy.direction;
        const flow = analyzeDirectionalFlow(
            zoneLayer?.flow,
            direction
        );

        const approachFlow = analyzeDirectionalFlow(
            approachLayer?.flow,
            direction
        );

        const zoneBuy = safeValue(zoneLayer?.flow?.buyValue);
        const zoneSell = safeValue(zoneLayer?.flow?.sellValue);
        const zoneTotal = zoneBuy + zoneSell;

        const approachBuy = safeValue(approachLayer?.flow?.buyValue);
        const approachSell = safeValue(approachLayer?.flow?.sellValue);
        const approachTotal = approachBuy + approachSell;

        const buyPercent = zoneTotal
            ? zoneBuy / zoneTotal * 100
            : 0;

        const sellPercent = zoneTotal
            ? zoneSell / zoneTotal * 100
            : 0;

        const approachBuyPercent = approachTotal
            ? approachBuy / approachTotal * 100
            : 0;

        const approachSellPercent = approachTotal
            ? approachSell / approachTotal * 100
            : 0;

        const metrics = [
            {
                label: "الحكم الاستراتيجي",
                value: getVerdictTitle(evaluation),
                tone: getVerdictTone(evaluation),
                detail: "تقييم توافق الأدلة مع سيناريو الصفقة"
            },
            {
                label: "اتجاه الصفقة",
                value: directionName(direction),
                tone: direction === "long" ? "buy" : "sell"
            },
            {
                label: "السعر المرجعي",
                value: formatPrice(referencePrice),
                tone: "blue",
                detail: "آخر تنفيذ في الفترة التاريخية"
            },
            {
                label: "موقع السعر",
                value: position.description,
                tone: position.inside ? "buy" : "gold"
            },
            {
                label: "تنفيذات داخل المنطقة",
                value: formatNumber(dataQuality.zoneTradeCount),
                tone: "blue"
            },
            {
                label: "قراءة المبادرة",
                value: flow.status,
                tone: flow.tone,
                detail: flow.share === null
                    ? "العينة محدودة"
                    : `حصة المبادرة المؤيدة: ${formatPercent(flow.share)}`
            }
        ];

        const timelineRows = buildTimelineRows(globalLayer);

        const sections = [
            buildStrategyVerdictSection(evaluation),

            {
                type: "note",
                title: "كيف نقرأ الحكم؟",
                text:
                    "المحلل مستشار لتفسير الأدلة وليس بوابة تمنع الدخول. " +
                    "التأييد يعني وجود قرائن متوافقة مع السيناريو، والتحذير يعني وجود أدلة تستحق الانتباه. " +
                    "أما نقص البيانات فلا يعني وجود دليل معاكس."
            },

            {
                type: "note",
                title: "بيانات منطقة الدخول",
                text:
                    `اتجاه الصفقة: ${directionName(direction)}.\n` +
                    `الحد الأعلى: ${formatPrice(strategy.upper)}.\n` +
                    `الحد الأدنى: ${formatPrice(strategy.lower)}.\n` +
                    `السعر المرجعي: ${formatPrice(referencePrice)}.\n` +
                    `موقع السعر: ${position.description}.\n` +
                    `${scenario.pathDescription}\n` +
                    `${scenario.approachInterpretation}`
            },

            {
                type: "bars",
                title: "ميزان المبادرة داخل المنطقة",
                description: "قيمة التنفيذات المبادرِة داخل حدود المنطقة.",
                items: [
                    {
                        label: "شراء مبادر",
                        value: zoneBuy,
                        display: `${formatMoney(zoneBuy)} — ${formatPercent(buyPercent)}`,
                        tone: "buy"
                    },
                    {
                        label: "بيع مبادر",
                        value: zoneSell,
                        display: `${formatMoney(zoneSell)} — ${formatPercent(sellPercent)}`,
                        tone: "sell"
                    }
                ]
            },

            {
                type: "note",
                title: "قراءة المبادرة داخل المنطقة",
                text:
                    `${flow.status}. ${flow.explanation}\n` +
                    `عدد التنفيذات داخل المنطقة: ${formatNumber(dataQuality.zoneTradeCount)}.`
            },

            {
                type: "bars",
                title: "ميزان المبادرة في ممر الوصول",
                description: "قيمة التنفيذات بين السعر المرجعي وحدود المنطقة.",
                items: [
                    {
                        label: "شراء مبادر",
                        value: approachBuy,
                        display: `${formatMoney(approachBuy)} — ${formatPercent(approachBuyPercent)}`,
                        tone: "buy"
                    },
                    {
                        label: "بيع مبادر",
                        value: approachSell,
                        display: `${formatMoney(approachSell)} — ${formatPercent(approachSellPercent)}`,
                        tone: "sell"
                    }
                ]
            },

            {
                type: "note",
                title: "قراءة ممر الوصول",
                text:
                    `${approachFlow.status}. ${approachFlow.explanation}\n` +
                    `${scenario.approachInterpretation}\n` +
                    `عدد تنفيذات الممر: ${formatNumber(dataQuality.approachTradeCount)}.`
            },

            ...buildFindingsSections(evidence.findings),

            ...buildLayerSections(
                globalLayer,
                "البصمة العامة للفترة"
            ),

            ...buildLayerSections(
                approachLayer,
                "بصمة ممر الوصول"
            ),

            ...buildLayerSections(
                zoneLayer,
                "بصمة التداول داخل المنطقة"
            ),

            {
                type: "table",
                title: "التسلسل الزمني لنشاط السوق",
                description: "آخر النوافذ النشطة في الفترة التاريخية.",
                columns: [
                    "الترتيب",
                    "الوقت",
                    "شراء مبادر",
                    "بيع مبادر",
                    "الغلبة"
                ],
                rows: timelineRows
            },

            {
                type: "note",
                title: "جودة العينة",
                text:
                    `عدد التنفيذات الصالحة: ${formatNumber(dataQuality.tradeCount)}.\n` +
                    `عدد نوافذ النشاط العامة: ${formatNumber(dataQuality.globalWindowCount)}.\n` +
                    `تنفيذات ممر الوصول: ${formatNumber(dataQuality.approachTradeCount)}.\n` +
                    `تنفيذات المنطقة: ${formatNumber(dataQuality.zoneTradeCount)}.\n` +
                    `عدد صفحات الجلب: ${formatNumber(dataQuality.fetchPages)}.\n` +
                    `اكتملت حلقة الجلب: ${dataQuality.fetchComplete ? "نعم" : "غير مؤكد"}.`
            },

            {
                type: "note",
                title: "حدود التحليل",
                text: safeArray(limitations)
                    .map((item, index) => `${index + 1}. ${item}`)
                    .join("\n")
            },

            {
                type: "note",
                title: "الخلاصة الاستراتيجية",
                text:
                    `${getVerdictTitle(evaluation)}.\n\n` +
                    `${evaluation?.explanation || ""}\n\n` +
                    `حلل المحرك ${formatNumber(dataQuality.tradeCount)} تنفيذ تاريخي. ` +
                    `السعر المرجعي ${formatPrice(referencePrice)}. ` +
                    `عدد تنفيذات المنطقة ${formatNumber(dataQuality.zoneTradeCount)}.\n\n` +
                    "الرادار يفسر الأدلة ولا يتخذ قرار الدخول أو الامتناع نيابة عن المتداول."
            }
        ];

        renderDashboard({
            title: "🧠 المحلل الاستراتيجي",
            symbol: market.symbol,
            subtitle:
                `تحليل ${directionName(direction)} — تقييم الأدلة حول منطقة Order Block`,
            metrics,
            sections
        });

    } catch (error) {
        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال التحليل الاستراتيجي</h3>
                <p>${escapeHTML(error.message || error)}</p>
            </div>
        `;
    }
}
