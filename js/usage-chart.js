// 1日あたりの使用時間の積み上げ棒グラフ（SVG）。データはusage-stats.jsのcomputeDailyUsageの戻り値。
import { colorHex } from "./colors.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { top: 12, right: 8, bottom: 26, left: 40 };
const HEIGHT = 220;
const SEGMENT_GAP = 2; // 積み上げた区画どうしの間に背景色の隙間を空ける
const TOP_RADIUS = 4;

function svg(tag, attrs = {}){
    const node = document.createElementNS(SVG_NS, tag);
    for(const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
}

export function formatHoursMinutes(seconds){
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if(h === 0) return `${m}分`;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

// 軸の単位と目盛り。最大値が2時間以下なら分、それより大きければ時間で表示する。
function buildScale(maxSeconds){
    const maxMin = Math.max(maxSeconds / 60, 1);
    const useHours = maxMin > 120;
    const steps = useHours ? [60, 120, 180, 240, 360] : [1, 2, 5, 10, 15, 20, 30];
    const step = steps.find(s => maxMin / s <= 4) || steps[steps.length - 1];
    const top = Math.ceil(maxMin / step) * step;
    const ticks = [];
    for(let v = 0; v <= top; v += step) ticks.push(v);
    return {
        maxSeconds: top * 60,
        ticks: ticks.map(min => ({ seconds: min * 60, label: useHours ? `${min / 60}h` : `${min}分` })),
    };
}

// 上端だけ角を丸めた矩形（下端はベースライン側なので角を付けない）
function topRoundedRect(x, y, w, h, r){
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function dayLabel(date){
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function renderUsageChart({ chart, legend, summary, tooltip }, data){
    chart.innerHTML = "";
    legend.innerHTML = "";
    tooltip.hidden = true;

    const { days, series, totalSeconds } = data;
    summary.textContent = days.length
        ? `合計 ${formatHoursMinutes(totalSeconds)} ・ 1日平均 ${formatHoursMinutes(totalSeconds / days.length)}`
        : "";

    const width = Math.max(chart.clientWidth || 0, 280);
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const maxDay = Math.max(0, ...days.map(d => d.totalSeconds));
    const scale = buildScale(maxDay);
    const yOf = sec => MARGIN.top + plotH - (sec / scale.maxSeconds) * plotH;

    const root = svg("svg", {
        width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`,
        role: "img",
        "aria-label": `1日あたりの使用時間の棒グラフ。${summary.textContent}`,
    });

    // 目盛り線（控えめ）
    for(const t of scale.ticks){
        const y = yOf(t.seconds);
        root.appendChild(svg("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: y, y2: y, class: t.seconds === 0 ? "chart-baseline" : "chart-grid" }));
        const label = svg("text", { x: MARGIN.left - 6, y: y + 4, "text-anchor": "end", class: "chart-axis-label" });
        label.textContent = t.label;
        root.appendChild(label);
    }

    const slotW = plotW / Math.max(days.length, 1);
    const barW = Math.max(2, Math.min(28, slotW * 0.7));
    const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 44)));

    days.forEach((day, i) => {
        const cx = MARGIN.left + slotW * (i + 0.5);
        const x = cx - barW / 2;
        const parts = series.filter(s => day.totals[s.id] > 0);
        let base = MARGIN.top + plotH;
        parts.forEach((s, j) => {
            const h = (day.totals[s.id] / scale.maxSeconds) * plotH;
            const isTop = j === parts.length - 1;
            const drawH = Math.max(isTop ? h : h - SEGMENT_GAP, 0.5);
            const y = base - h;
            const fill = colorHex(s.color);
            if(isTop) root.appendChild(svg("path", { d: topRoundedRect(x, y, barW, drawH, TOP_RADIUS), fill }));
            else root.appendChild(svg("rect", { x, y: y + SEGMENT_GAP, width: barW, height: drawH, fill }));
            base = y;
        });

        if(i % labelEvery === 0){
            const label = svg("text", { x: cx, y: HEIGHT - 8, "text-anchor": "middle", class: "chart-axis-label" });
            label.textContent = dayLabel(day.date);
            root.appendChild(label);
        }

        // ヒット領域は棒より広く、列の全高にする（タップしやすくするため）
        const hit = svg("rect", { x: MARGIN.left + slotW * i, y: MARGIN.top, width: slotW, height: plotH, class: "chart-hit" });
        const show = () => showTooltip({ chart, tooltip }, day, series, cx, yOf(day.totalSeconds));
        hit.addEventListener("pointerenter", show);
        hit.addEventListener("click", show);
        root.appendChild(hit);
    });

    root.addEventListener("pointerleave", event => {
        if(event.pointerType === "mouse") tooltip.hidden = true;
    });
    chart.appendChild(root);

    // 凡例（期間内の合計つき。色だけに頼らず活動名と時間を表で読めるようにする）
    for(const s of series){
        const li = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.className = "chart-legend-swatch";
        swatch.style.backgroundColor = colorHex(s.color);
        const name = document.createElement("span");
        name.className = "chart-legend-name";
        name.textContent = s.name;
        const value = document.createElement("span");
        value.className = "chart-legend-value";
        value.textContent = formatHoursMinutes(s.totalSeconds);
        li.append(swatch, name, value);
        legend.appendChild(li);
    }
}

function showTooltip({ chart, tooltip }, day, series, cx, topY){
    tooltip.innerHTML = "";
    const head = document.createElement("p");
    head.className = "chart-tooltip-head";
    head.textContent = `${dayLabel(day.date)}（${WEEKDAYS[day.date.getDay()]}） ${formatHoursMinutes(day.totalSeconds)}`;
    tooltip.appendChild(head);
    for(const s of series){
        const sec = day.totals[s.id];
        if(!sec) continue;
        const row = document.createElement("p");
        row.className = "chart-tooltip-row";
        const sw = document.createElement("span");
        sw.className = "chart-legend-swatch";
        sw.style.backgroundColor = colorHex(s.color);
        row.append(sw, document.createTextNode(`${s.name}　${formatHoursMinutes(sec)}`));
        tooltip.appendChild(row);
    }
    if(!day.totalSeconds){
        const row = document.createElement("p");
        row.className = "chart-tooltip-row";
        row.textContent = "記録なし";
        tooltip.appendChild(row);
    }
    tooltip.hidden = false;
    // 棒の上に表示し、グラフの左右からはみ出さないようにする
    const w = tooltip.offsetWidth;
    const maxLeft = chart.clientWidth - w;
    tooltip.style.left = `${Math.max(0, Math.min(maxLeft, cx - w / 2))}px`;
    tooltip.style.top = `${Math.max(0, topY - tooltip.offsetHeight - 8)}px`;
}
