// 履歴から「1日あたりの使用時間（活動ごと）」を集計する（DOMに依存しない純粋な計算）。
//
// - 日付は端末のローカル時刻で区切る。日をまたぐ記録は、それぞれの日に按分する。
// - 系列（活動）の並び順・色は活動項目の並びと色に従う（期間を変えても色や順番は変わらない）。
import { DEFAULT_ACTIVITIES } from "./storage.js";

export const MAX_RANGE_DAYS = 366;

export function startOfDay(date){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// "YYYY-MM-DD"（ローカル日付）
export function toDateKey(date){
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(key){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if(!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}

function activityIdOf(entry){
    return entry.activityId || String(entry.title || "").split(":")[0] || "activity-other";
}

// 系列の一覧（表示順）。活動項目の並び順を基本とし、削除済みでも期間内に記録があれば含める。
function buildSeries(activities, usedIds, entryColorById){
    const series = [];
    const seen = new Set();
    for(const a of activities){
        if(!usedIds.has(a.id)) continue;
        series.push({ id: a.id, name: a.name, color: a.color || entryColorById.get(a.id) || "8" });
        seen.add(a.id);
    }
    for(const id of usedIds){
        if(seen.has(id)) continue;
        const def = DEFAULT_ACTIVITIES.find(a => a.id === id);
        series.push({ id, name: def ? def.name : "削除された活動", color: entryColorById.get(id) || (def && def.color) || "8" });
    }
    return series;
}

// start, end: Date（両端の日を含む）。戻り値:
// { days: [{ key, date, totals: { [activityId]: 秒 }, totalSeconds }], series: [{ id, name, color, totalSeconds }], totalSeconds }
export function computeDailyUsage(history, activities, start, end){
    const rangeStart = startOfDay(start);
    const rangeEnd = addDays(startOfDay(end), 1); // 終了日の翌日0時（この時刻は含まない）

    const days = [];
    const indexByKey = new Map();
    for(let d = rangeStart; d < rangeEnd; d = addDays(d, 1)){
        indexByKey.set(toDateKey(d), days.length);
        days.push({ key: toDateKey(d), date: d, totals: {}, totalSeconds: 0 });
    }

    const usedIds = new Set();
    const entryColorById = new Map();

    for(const entry of history){
        const s = new Date(entry.date_start).getTime();
        const e = new Date(entry.date_end).getTime();
        if(Number.isNaN(s) || Number.isNaN(e) || e <= s) continue;
        const clipStart = Math.max(s, rangeStart.getTime());
        const clipEnd = Math.min(e, rangeEnd.getTime());
        if(clipEnd <= clipStart) continue;

        const id = activityIdOf(entry);
        // 日ごとに区切って加算する
        let cursor = clipStart;
        while(cursor < clipEnd){
            const dayStart = startOfDay(new Date(cursor));
            const nextDay = addDays(dayStart, 1).getTime();
            const segEnd = Math.min(clipEnd, nextDay);
            const idx = indexByKey.get(toDateKey(dayStart));
            if(idx != null){
                const sec = (segEnd - cursor) / 1000;
                const day = days[idx];
                day.totals[id] = (day.totals[id] || 0) + sec;
                day.totalSeconds += sec;
            }
            cursor = segEnd;
        }
        usedIds.add(id);
        if(!entryColorById.has(id) && entry.color) entryColorById.set(id, String(entry.color));
    }

    const series = buildSeries(activities, usedIds, entryColorById).map(s => ({
        ...s,
        totalSeconds: days.reduce((sum, d) => sum + (d.totals[s.id] || 0), 0),
    }));
    const totalSeconds = days.reduce((sum, d) => sum + d.totalSeconds, 0);
    return { days, series, totalSeconds };
}
