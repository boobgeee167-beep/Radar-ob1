
/**
 * WHALE RADAR
 * UNIFIED VISUAL RESULTS ENGINE
 * محرك العرض البصري الموحد
 */

const COLORS = {
    buy: "#16c784",
    sell: "#ea3943",
    neutral: "#8b95a5",
    gold: "#e8b44f",
    blue: "#3988f7"
};

function escapeHTML(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]
    );
}

function injectStyles() {

    if (document.getElementById("whale-visual-styles")) {
        return;
    }

    const style = document.createElement("style");

    style.id = "whale-visual-styles";

    style.textContent = `

        .whale-dashboard {
            color: #e8edf5;
            direction: rtl;
            text-align: right;
            display: flex;
            flex-direction: column;
            gap: 16px;
            font-family: inherit;
        }

        .whale-header {
            padding: 20px;
            border: 1px solid #293344;
            border-radius: 16px;
            background: linear-gradient(135deg,#182437,#111923);
        }

        .whale-header h2 {
            margin: 0 0 8px;
            font-size: 19px;
        }

        .whale-header p {
            margin: 0;
            color: #9ba8ba;
            font-size: 12px;
        }

        .whale-metrics {
            display: grid;
            grid-template-columns: repeat(2,minmax(0,1fr));
            gap: 10px;
        }

        .whale-metric {
            background: #151e2b;
            border: 1px solid #293344;
            border-radius: 13px;
            padding: 14px;
            min-width: 0;
        }

        .whale-metric-label {
            color: #9ba8ba;
            font-size: 11px;
            margin-bottom: 9px;
        }

        .whale-metric-value {
            font-size: 17px;
            font-weight: 800;
            overflow-wrap: anywhere;
        }

        .whale-metric-detail {
            color: #8b95a5;
            font-size: 10px;
            margin-top: 6px;
        }

        .whale-section {
            background: #151e2b;
            border: 1px solid #293344;
            border-radius: 14px;
            padding: 15px;
            min-width: 0;
        }

        .whale-section h3 {
            font-size: 14px;
            margin: 0 0 14px;
        }

        .whale-section-description {
            color: #9ba8ba;
            font-size: 11px;
            margin: -7px 0 13px;
        }

        .whale-bar-item {
            margin: 13px 0;
        }

        .whale-bar-heading {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            margin-bottom: 7px;
        }

        .whale-bar-value {
            font-weight: 700;
        }

        .whale-bar-track {
            height: 9px;
            border-radius: 10px;
            background: #293344;
            overflow: hidden;
        }

        .whale-bar-fill {
            height: 100%;
            border-radius: 10px;
        }

        .whale-table-wrap {
            overflow-x: auto;
        }

        .whale-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            min-width: 300px;
        }

        .whale-table th {
            color: #9ba8ba;
            font-weight: 600;
            padding: 10px 7px;
            text-align: right;
            border-bottom: 1px solid #303c4d;
        }

        .whale-table td {
            padding: 12px 7px;
            border-bottom: 1px solid #252f3e;
            overflow-wrap: anywhere;
        }

        .whale-table tr:last-child td {
            border-bottom: none;
        }

        .whale-note {
            padding: 13px;
            border-radius: 11px;
            background: #1b2939;
            border-right: 3px solid ${COLORS.gold};
            color: #bdc9d8;
            font-size: 11px;
            line-height: 1.9;
        }

        .whale-buy {
            color: ${COLORS.buy};
        }

        .whale-sell {
            color: ${COLORS.sell};
        }

        .whale-neutral {
            color: ${COLORS.neutral};
        }

        .whale-empty {
            text-align: center;
            color: #9ba8ba;
            padding: 20px 8px;
            font-size: 12px;
        }

        @media (min-width: 600px) {
            .whale-metrics {
                grid-template-columns: repeat(4,minmax(0,1fr));
            }
        }

    `;

    document.head.appendChild(style);
}

function renderMetric(metric) {

    const tone = ["buy", "sell", "neutral", "gold", "blue"]
        .includes(metric.tone)
        ? metric.tone
        : "neutral";

    return `
        <div class="whale-metric">

            <div class="whale-metric-label">
                ${escapeHTML(metric.label)}
            </div>

            <div class="whale-metric-value whale-${tone}">
                ${escapeHTML(metric.value)}
            </div>

            ${
                metric.detail
                    ? `<div class="whale-metric-detail">
                        ${escapeHTML(metric.detail)}
                    </div>`
                    : ""
            }

        </div>
    `;
}

function renderBars(section) {

    const items = section.items || [];

    if (!items.length) {
        return `<div class="whale-empty">لا توجد بيانات للعرض</div>`;
    }

    const maximum = Math.max(
        1,
        ...items.map(item => Number(item.value) || 0)
    );

    return items.map(item => {

        const value = Math.max(0, Number(item.value) || 0);

        const width = Math.min(100, value / maximum * 100);

        const color = COLORS[item.tone] || COLORS.blue;

        return `
            <div class="whale-bar-item">

                <div class="whale-bar-heading">
                    <span>${escapeHTML(item.label)}</span>
                    <span class="whale-bar-value">
                        ${escapeHTML(item.display ?? item.value)}
                    </span>
                </div>

                <div class="whale-bar-track">
                    <div class="whale-bar-fill"
                        style="width:${width}%;background:${color}">
                    </div>
                </div>

            </div>
        `;

    }).join("");
}

function renderTable(section) {

    const columns = section.columns || [];
    const rows = section.rows || [];

    if (!rows.length) {
        return `<div class="whale-empty">لا توجد بيانات للعرض</div>`;
    }

    return `
        <div class="whale-table-wrap">

            <table class="whale-table">

                <thead>
                    <tr>
                        ${columns.map(column =>
                            `<th>${escapeHTML(column)}</th>`
                        ).join("")}
                    </tr>
                </thead>

                <tbody>
                    ${rows.map(row => `
                        <tr>
                            ${row.map(cell =>
                                `<td>${escapeHTML(cell)}</td>`
                            ).join("")}
                        </tr>
                    `).join("")}
                </tbody>

            </table>

        </div>
    `;
}

function renderSection(section) {

    let content = "";

    if (section.type === "bars") {
        content = renderBars(section);
    } else if (section.type === "table") {
        content = renderTable(section);
    } else if (section.type === "note") {
        content = `
            <div class="whale-note">
                ${escapeHTML(section.text)}
            </div>
        `;
    }

    return `
        <section class="whale-section">

            <h3>${escapeHTML(section.title)}</h3>

            ${
                section.description
                    ? `<p class="whale-section-description">
                        ${escapeHTML(section.description)}
                    </p>`
                    : ""
            }

            ${content}

        </section>
    `;
}

export function renderDashboard(options) {

    injectStyles();

    const root = document.getElementById("results-section");

    if (!root) {
        throw new Error("منطقة النتائج غير موجودة");
    }

    const metrics = options.metrics || [];
    const sections = options.sections || [];

    root.innerHTML = `

        <div class="whale-dashboard">

            <header class="whale-header">

                <h2>${escapeHTML(options.title)}</h2>

                <p>
                    ${escapeHTML(options.symbol || "")}
                    ${options.subtitle
                        ? " — " + escapeHTML(options.subtitle)
                        : ""
                    }
                </p>

            </header>

            ${
                metrics.length
                    ? `<div class="whale-metrics">
                        ${metrics.map(renderMetric).join("")}
                    </div>`
                    : ""
            }

            ${sections.map(renderSection).join("")}

        </div>

    `;

}
