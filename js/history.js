// 活動履歴（FR-009, FR-010）。
//
// 履歴の各エントリは、カレンダー連動プログラム（class.js のEvent）がそのまま読める
// フィールド名で保存する: id / title / description / date_start / date_end / color。
// activityId・durationSeconds・createdAtはSelf Pause独自の付加情報として保持する。
import { saveState, generateId, isoNow } from "./storage.js";

const MS_PER_DAY = 86400000;

export function pruneExpiredHistory(state){
    const retentionMs = (state.settings.historyRetentionDays || 365) * MS_PER_DAY;
    const cutoff = Date.now() - retentionMs;
    const before = state.history.length;
    state.history = state.history.filter(h => new Date(h.date_end).getTime() >= cutoff);
    return before !== state.history.length;
}

// LOCK_COUNTDOWN完了時に作られたpendingHistoryへ、選ばれた活動を紐付けて確定する。
export function finalizeHistory(state, activity){
    const pending = state.pendingHistory;
    if(!pending) return null;
    const entry = {
        id: generateId("history"),
        activityId: activity.id,
        title: activity.id + ":" + Math.floor((new Date(pending.endedAt) - new Date(pending.startedAt))/1000).toString().padStart(5, "0"),
        description: "Self Pauseで記録された使用時間",
        date_start: pending.startedAt,
        date_end: pending.endedAt,
        color: activity.color || "3",
        durationSeconds: pending.durationSeconds,
        createdAt: isoNow(),
    };
    state.history.push(entry);
    state.pendingHistory = null;
    pruneExpiredHistory(state);
    saveState(state);
    return entry;
}

export function markCalendarSynced(state, id, synced){
    const entry = state.history.find(h => h.id === id);
    if(!entry) return;
    entry.calendarSynced = synced;
    saveState(state);
}

export function deleteHistoryEntry(state, id){
    state.history = state.history.filter(h => h.id !== id);
    saveState(state);
}

export function clearAllHistory(state){
    state.history = [];
    saveState(state);
}

export function listHistoryByMonth(state, year, month){ // month: 1-12
    return state.history
        .filter(h => {
            const d = new Date(h.date_start);
            return d.getFullYear() === year && (d.getMonth() + 1) === month;
        })
        .sort((a, b) => new Date(b.date_start) - new Date(a.date_start));
}

// 履歴が存在する年月の一覧（新しい順）。月切り替えUIの範囲決定に使う。
export function listAvailableMonths(state){
    const set = new Set();
    const now = new Date();
    set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    for(const h of state.history){
        const d = new Date(h.date_start);
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return Array.from(set).sort().reverse();
}
