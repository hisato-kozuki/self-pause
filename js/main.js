import * as StateMachine from "./state.js";
import { getStorageWarning, clearStorageWarning } from "./storage.js";
import { listActivities, getSelectableActivities, addActivity, updateActivity, deleteActivity } from "./activities.js";
import { markCalendarSynced, pruneExpiredHistory, deleteHistoryEntry, clearAllHistory, listHistoryByMonth, listAvailableMonths } from "./history.js";
import * as ui from "./ui.js";
import { getApiUrl, setApiUrl, postEvents, toCalendarEvent } from "./calendar-api.js";

const appState = StateMachine.init();
if(pruneExpiredHistory(appState)){
    // 起動時に期限切れの履歴があれば削除して保存する。
    import("./storage.js").then(({ saveState }) => saveState(appState));
}
ui.setStorageWarning(getStorageWarning());
clearStorageWarning();

let currentPage = "home"; // "home" | "history" | "activities"
let lastView = StateMachine.getView();

const now = new Date();
let historyMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };

let editingActivityId = null; // null = 新規追加、それ以外 = 編集対象のid
let dialogColor = "8";

// ===== 画面描画 =====

function renderCurrentPage(){
    console.log("renderCurrentPage", currentPage)
    if(currentPage === "home"){
        ui.renderHome(lastView, {
            selectableActivities: getSelectableActivities(appState),
            onSelectActivity: handleSelectActivity,
        });
    } else if(currentPage === "history"){
        renderHistoryPage();
    } else if(currentPage === "activities"){
        renderActivitiesPage();
    }
}

function renderHistoryPage(){
    ui.renderHistoryMonth(historyMonth.year, historyMonth.month);
    const entries = listHistoryByMonth(appState, historyMonth.year, historyMonth.month);
    ui.renderHistoryList(entries, { onDelete: handleDeleteHistory, onRetry: handleRetrySync });
}

function renderActivitiesPage(){
    ui.renderActivityList(listActivities(appState), { onOpenEdit: openEditActivityDialog });
}

// ===== 状態遷移からの更新 =====

StateMachine.onChange(view => {
    lastView = view;
    if(currentPage === "home") ui.renderHome(view, {
        selectableActivities: getSelectableActivities(appState),
        onSelectActivity: handleSelectActivity,
    });
});

const ACTIVITY_CONFIRM_DELAY_MS = matchMedia("(prefers-reduced-motion: reduce)").matches ? 300 : 1200;

// 履歴エントリをGoogleカレンダーへ登録し、結果を履歴の calendarSynced に記録する。
// 結果は { ok, message } で返す。メッセージの表示は呼び出し側で行う。
async function syncEntryToCalendar(id){
    const entry = appState.history.find(h => h.id === id);
    if(!entry) return { ok: false, message: "記録が見つかりません" };
    try{
        await postEvents([toCalendarEvent(entry)]);
        markCalendarSynced(appState, id, true);
        return { ok: true };
    } catch(e){
        markCalendarSynced(appState, id, false);
        return { ok: false, message: e.name === "AbortError" ? "通信がタイムアウトしました" : e.message };
    }
}

async function handleSelectActivity(activity){
    const entry = StateMachine.selectActivity(activity);
    if(!entry) return;
    ui.flashActivityDone();
    if(!getApiUrl()){
        markCalendarSynced(appState, entry.id, false);
        ui.setCalendarStatus("APIのURLが未設定のため、Googleカレンダーには登録していません（活動内容管理画面で設定できます）", "error");
    } else {
        ui.setCalendarStatus("Googleカレンダーに登録中…");
        const result = await syncEntryToCalendar(entry.id);
        if(result.ok) ui.setCalendarStatus("Googleカレンダーに登録しました", "ok");
        else ui.setCalendarStatus(`Googleカレンダーへの登録に失敗しました（履歴画面から再登録できます）: ${result.message}`, "error");
    }
    // 「記録しました」を一瞬見せてから、次の解禁カウントダウンへ進む。
    // setTimeout(() => StateMachine.onForeground(), ACTIVITY_CONFIRM_DELAY_MS);
}

// ===== ナビゲーション（履歴・活動内容管理はブラウザ履歴に積む） =====

function navigateTo(page, { push = true } = {}){
    currentPage = page;
    ui.showPage(page === "history" || page === "activities" ? page : "home");
    if(page === "history"){
        const months = listAvailableMonths(appState);
        if(months.length > 0){
            const label = `${historyMonth.year}-${String(historyMonth.month).padStart(2, "0")}`;
            if(!months.includes(label)){
                const [y, m] = months[0].split("-").map(Number);
                historyMonth = { year: y, month: m };
            }
        }
    }
    renderCurrentPage();
    if(push) history.pushState({ selfPausePage: page }, "", "#" + page);
}

document.addEventListener("click", event => {
    const navBtn = event.target.closest("[data-nav]");
    if(!navBtn) return;
    navigateTo(navBtn.dataset.nav);
});

window.addEventListener("popstate", event => {
    // 戻る操作: カウントダウン中なら中断する（状態は変えない）。
    StateMachine.onInterrupt();
    const page = (event.state && event.state.selfPausePage) || "home";
    navigateTo(page, { push: false });
});

// ===== 履歴画面 =====

document.getElementById("prevMonthBtn").addEventListener("click", () => {
    historyMonth.month -= 1;
    if(historyMonth.month < 1){ historyMonth.month = 12; historyMonth.year -= 1; }
    renderHistoryPage();
});
document.getElementById("nextMonthBtn").addEventListener("click", () => {
    historyMonth.month += 1;
    if(historyMonth.month > 12){ historyMonth.month = 1; historyMonth.year += 1; }
    renderHistoryPage();
});
document.getElementById("clearAllHistoryBtn").addEventListener("click", () => {
    const entries = listHistoryByMonth(appState, historyMonth.year, historyMonth.month);
    if(entries.length === 0) return;
    const ok = confirm(`${historyMonth.year}年${historyMonth.month}月の記録を${entries.length}件すべて削除します。よろしいですか？`);
    if(!ok) return;
    const idsToRemove = new Set(entries.map(e => e.id));
    appState.history = appState.history.filter(h => !idsToRemove.has(h.id));
    import("./storage.js").then(({ saveState }) => saveState(appState));
    renderHistoryPage();
});

async function handleRetrySync(id){
    if(!getApiUrl()){
        alert("活動内容管理画面でAPIのURLを設定してください。");
        return;
    }
    const result = await syncEntryToCalendar(id);
    if(!result.ok) alert(`Googleカレンダーへの登録に失敗しました: ${result.message}`);
    if(currentPage === "history") renderHistoryPage();
}

function handleDeleteHistory(id){
    deleteHistoryEntry(appState, id);
    renderHistoryPage();
}

// 全履歴一括削除は活動内容管理画面ではなく、将来的な設定画面向けに残す最小実装として
// clearAllHistoryも公開しておく（現状は上記の月単位削除から利用）。
void clearAllHistory;

// ===== 活動内容管理画面 =====

ui.setApiUrlField(getApiUrl());
document.getElementById("calendarSettingsForm").addEventListener("submit", event => {
    event.preventDefault();
    const ok = setApiUrl(ui.getApiUrlField());
    ui.setApiUrlStatus(ok ? "保存しました" : "保存できませんでした");
});

document.getElementById("addActivityBtn").addEventListener("click", () => {
    openAddActivityDialog();
});

function setDialogColor(color){
    dialogColor = color;
    ui.renderColorPicker(dialogColor, setDialogColor);
}

function openAddActivityDialog(){
    editingActivityId = null;
    setDialogColor("8");
    ui.openActivityDialog({ title: "活動を追加", name: "", color: dialogColor, showDelete: false });
}

function openEditActivityDialog(activity){
    editingActivityId = activity.id;
    setDialogColor(activity.color || "8");
    ui.openActivityDialog({ title: "活動を編集", name: activity.name, color: dialogColor, showDelete: true });
}

document.getElementById("activityForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = ui.getActivityDialogName();
    try{
        if(editingActivityId){
            updateActivity(appState, editingActivityId, { name, color: dialogColor });
        } else {
            addActivity(appState, name, dialogColor);
        }
    } catch(e){
        alert(e.message);
        return;
    }
    ui.closeActivityDialog();
    if(currentPage === "activities") renderActivitiesPage();
});

document.getElementById("activityCancelBtn").addEventListener("click", () => {
    ui.closeActivityDialog();
});

document.getElementById("activityDeleteBtn").addEventListener("click", () => {
    if(!editingActivityId) return;
    const ok = confirm("この活動項目を削除します。過去の履歴には引き続き表示されます。よろしいですか？");
    if(!ok) return;
    deleteActivity(appState, editingActivityId);
    ui.closeActivityDialog();
    if(currentPage === "activities") renderActivitiesPage();
});

// ===== ページライフサイクル =====

document.addEventListener("visibilitychange", () => {
    if(document.hidden){
        StateMachine.onInterrupt();
    } else {
        pruneExpiredHistory(appState);
        StateMachine.onForeground();
    }
});

// bfcache（戻る/進むでのページ復元）対策。
window.addEventListener("pageshow", () => {
    if(!document.hidden) StateMachine.onForeground();
});

// ===== 初期化 =====

// 先にカウントダウン開始判定（FR-001, 再起動時の挙動）を行ってlastViewを確定させてから、
// ホーム画面を表示する（そうしないと一瞬だけ誤った初期画面が見えてしまう）。
StateMachine.onForeground();
navigateTo("home", { push: false });
history.replaceState({ selfPausePage: "home" }, "", "#home");
