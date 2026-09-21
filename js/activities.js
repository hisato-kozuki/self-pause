// 活動項目（FR-008）のCRUD。履歴は活動名のスナップショット（title）を持つため、
// 削除は論理削除とし、過去の履歴表示に影響しないようにする。
import { saveState, generateId, isoNow } from "./storage.js";

export function listActivities(state, { includeDeleted = false } = {}){
    return state.activities.filter(a => includeDeleted || !a.isDeleted);
}

export function addActivity(state, name, color){
    const trimmed = (name || "").trim();
    if(!trimmed) throw new Error("活動名を入力してください");
    const now = isoNow();
    const activity = {
        id: generateId("activity"),
        name: trimmed,
        type: "custom",
        color: color || "8",
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
    };
    state.activities.push(activity);
    saveState(state);
    return activity;
}

export function updateActivity(state, id, { name, color } = {}){
    const activity = state.activities.find(a => a.id === id);
    if(!activity) throw new Error("活動項目が見つかりません");
    if(name != null){
        const trimmed = name.trim();
        if(!trimmed) throw new Error("活動名を入力してください");
        activity.name = trimmed;
    }
    if(color != null) activity.color = color;
    activity.updatedAt = isoNow();
    saveState(state);
    return activity;
}

export function deleteActivity(state, id){
    const activity = state.activities.find(a => a.id === id);
    if(!activity) return;
    activity.isDeleted = true;
    activity.updatedAt = isoNow();
    saveState(state);
}

// 使用禁止状態画面で選択させる候補。全項目が削除されていた場合の保険として
// 一時的な「その他」を1件だけ用意する（保存はしない）。
export function getSelectableActivities(state){
    const active = listActivities(state);
    if(active.length > 0) return active;
    return [{ id: "activity-fallback-other", name: "その他", color: "8", type: "default", isDeleted: false }];
}
