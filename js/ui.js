// DOM描画のみを担当する（状態を持たない）。main.jsから呼び出される。
import { COLOR_PALETTE, colorHex } from "./colors.js";
import { DEFAULT_ACTIVITIES, TIMER_MAX_MINUTES } from "./storage.js";

const el = {
    storageWarning: document.getElementById("storageWarning"),
    screens: {
        countdown: document.querySelector('[data-screen="countdown"]'),
        unlocked: document.querySelector('[data-screen="unlocked"]'),
        locked: document.querySelector('[data-screen="locked"]'),
        history: document.querySelector('[data-screen="history"]'),
        activities: document.querySelector('[data-screen="activities"]'),
    },
    bottomNav: document.getElementById("bottomNav"),
    navButtons: document.querySelectorAll(".nav-btn"),

    countdownLabel: document.getElementById("countdownLabel"),
    countdownNumber: document.getElementById("countdownNumber"),
    countdownMessage: document.getElementById("countdownMessage"),
    countdownConsoleIcon: document.getElementById("countdownConsoleIcon"),
    countdownChains: document.getElementById("countdownChains"),
    timerGrid: document.getElementById("timerGrid"),
    timerRemaining: document.getElementById("timerRemaining"),
    elapsedTime: document.getElementById("elapsedTime"),

    timerSettingsFields: document.getElementById("timerSettingsFields"),
    timerSettingsStatus: document.getElementById("timerSettingsStatus"),
    showTimerButtonsInput: document.getElementById("showTimerButtonsInput"),
    notificationStatus: document.getElementById("notificationStatus"),
    notificationPermissionBtn: document.getElementById("notificationPermissionBtn"),

    activityPicker: document.getElementById("activityPicker"),
    activityButtons: document.getElementById("activityButtons"),
    activityDoneMessage: document.getElementById("activityDoneMessage"),
    calendarStatus: document.getElementById("calendarStatus"),
    apiUrlInput: document.getElementById("apiUrlInput"),
    apiUrlStatus: document.getElementById("apiUrlStatus"),

    currentMonthLabel: document.getElementById("currentMonthLabel"),
    historyList: document.getElementById("historyList"),
    historyEmptyMessage: document.getElementById("historyEmptyMessage"),

    activityList: document.getElementById("activityList"),

    activityDialog: document.getElementById("activityDialog"),
    activityDialogTitle: document.getElementById("activityDialogTitle"),
    activityNameInput: document.getElementById("activityNameInput"),
    activityColorPicker: document.getElementById("activityColorPicker"),
    activityDeleteBtn: document.getElementById("activityDeleteBtn"),
};

export function showPage(page){
    for(const [name, section] of Object.entries(el.screens)){
        if(name === "history" || name === "activities"){
            section.hidden = name !== page;
        }
    }
    // home配下（countdown/unlocked/locked）の表示はrenderHome側が担当するため、
    // ここではhistory/activities以外を一旦すべて隠すだけにする。
    if(page === "history" || page === "activities"){
        el.screens.countdown.hidden = true;
        el.screens.unlocked.hidden = true;
        el.screens.locked.hidden = true;
    }
    el.bottomNav.hidden = false;
    for(const btn of el.navButtons){
        btn.classList.toggle("is-active", btn.dataset.nav === page);
    }
}

export function setStorageWarning(message){
    if(message){
        el.storageWarning.textContent = message;
        el.storageWarning.hidden = false;
    } else {
        el.storageWarning.hidden = true;
    }
}

const MESSAGES = {
    UNLOCK: "Now unlocking...",
    LOCK: "Now locking...",
};

let currentRunId = null;

// 鎖・アイコンの封印状態を切り替える（アイコン背景の発光も data-sealed で連動）。
function setSealed(sealed){
    el.countdownChains.classList.toggle("is-sealed", sealed);
    el.countdownConsoleIcon.dataset.sealed = String(sealed);
}

function startRun(initialSealed){
    const section = el.screens.countdown;
    // 遷移アニメーションを止めて、閉じた扉・縮小状態・初期の封印状態へ即座に戻す
    section.classList.add("no-anim");
    el.countdownChains.classList.add("no-anim");
    section.classList.remove("is-open");
    setSealed(initialSealed);
    void section.offsetWidth; // 強制リフロー
    section.classList.remove("no-anim");
    el.countdownChains.classList.remove("no-anim");
    // 閉じた状態を一瞬見せてから、扉を開くアニメーションと拡大アニメーションを同時に再生する
    setTimeout(() => section.classList.add("is-open"), 50);
}

// 扉を閉じた状態・封印状態へ即座に戻す（タイマー選択画面用）。
function closeDoors(){
    const section = el.screens.countdown;
    section.classList.add("no-anim");
    el.countdownChains.classList.add("no-anim");
    section.classList.remove("is-open");
    setSealed(true);
    void section.offsetWidth; // 強制リフロー
    section.classList.remove("no-anim");
    el.countdownChains.classList.remove("no-anim");
}

// 分数をボタン表示用の文字列にする（例: 5→"5分", 60→"1時間", 90→"1時間30分"）。
export function formatTimerLabel(minutes){
    if(!minutes) return "制限なし";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if(h === 0) return `${m}分`;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function renderTimerButtons(presets, onSelect){
    el.timerGrid.innerHTML = "";
    for(const minutes of [...presets, null]){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "timer-btn" + (minutes ? "" : " timer-btn-unlimited");
        btn.textContent = formatTimerLabel(minutes);
        btn.addEventListener("click", () => onSelect(minutes));
        el.timerGrid.appendChild(btn);
    }
}

function formatClock(totalSeconds){
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function renderTimerRemaining(view, timerButtonsEnabled){
    let text;
    if(view.timerRemainingSeconds == null) text = timerButtonsEnabled ? "利用時間　制限なし" : "";
    else if(view.timerExpired) text = "利用時間が終了しました";
    else text = `残り時間　${formatClock(view.timerRemainingSeconds)}`;
    el.timerRemaining.textContent = text;
    el.timerRemaining.classList.toggle("is-expired", !!view.timerExpired);
}

export function renderHome(view, { onSelectActivity, selectableActivities, timerPresets, onSelectTimer, timerButtonsEnabled } = {}){
    el.screens.history.hidden = true;
    el.screens.activities.hidden = true;

    const isCountdown = view.screen === "UNLOCK_COUNTDOWN" || view.screen === "LOCK_COUNTDOWN";
    const isTimerSelection = view.screen === "TIMER_SELECTION";
    el.screens.countdown.hidden = !isCountdown && !isTimerSelection;
    el.timerGrid.hidden = !isTimerSelection;
    el.screens.unlocked.hidden = view.screen !== "UNLOCKED";
    const isLockedLike = view.screen === "ACTIVITY_SELECTION" || view.screen === "LOCKED_IDLE";
    el.screens.locked.hidden = !isLockedLike;

    if(isTimerSelection){
        // 扉は閉じたまま、手前に利用時間のボタンを並べる。押されると解禁カウントダウンが始まる。
        currentRunId = null;
        closeDoors();
        renderTimerButtons(timerPresets || [], onSelectTimer);
    }

    if(view.screen === "UNLOCKED"){
        renderTimerRemaining(view, timerButtonsEnabled);
    }

    if(isCountdown){
        const mode = view.screen === "UNLOCK_COUNTDOWN" ? "UNLOCK" : "LOCK";
        el.countdownLabel.textContent = mode === "UNLOCK" ? "解禁まで" : "終了まで";
        el.countdownNumber.textContent = String(view.remainingSeconds);
        el.countdownMessage.textContent = MESSAGES[mode];

        // 解禁カウントダウンは「封印された状態」から始まり、完了と同時に解除する。
        // 終了カウントダウンは「封印されていない状態」から始まり、完了と同時に封印する。
        const sealedNow = mode === "UNLOCK" ? !view.completing : view.completing;

        if(view.runId !== currentRunId){
            // 新しいカウントダウンの開始: 扉は必ず閉じた状態から始め、直後に毎回開くアニメーションを流す。
            currentRunId = view.runId;
            startRun(sealedNow);
        } else {
            setSealed(sealedNow);
        }
    }

    if(isLockedLike){
        const showPicker = view.screen === "ACTIVITY_SELECTION";
        el.activityPicker.hidden = !showPicker;
        el.activityDoneMessage.hidden = true;
        el.calendarStatus.hidden = true;
        if(showPicker){
            renderActivityButtons(selectableActivities, onSelectActivity);
            el.elapsedTime.textContent = `今回の使用時間　${formatDuration(view.durationSeconds || 0)}`;
        }
    }
}

// Googleカレンダー登録の結果表示。kind: "ok" | "error" | ""（進行中）
export function setCalendarStatus(text, kind = ""){
    el.calendarStatus.textContent = text;
    el.calendarStatus.hidden = !text;
    el.calendarStatus.classList.toggle("is-ok", kind === "ok");
    el.calendarStatus.classList.toggle("is-error", kind === "error");
}

export function setApiUrlField(value){ el.apiUrlInput.value = value; }
export function getApiUrlField(){ return el.apiUrlInput.value.trim(); }
export function setApiUrlStatus(text){ el.apiUrlStatus.textContent = text; }

export function flashActivityDone(){
    el.activityPicker.hidden = true;
    el.activityDoneMessage.hidden = false;
}

function renderActivityButtons(activities, onSelect){
    el.activityButtons.innerHTML = "";
    for(const activity of activities){
        const btn = document.createElement("button");
        btn.type = "button";
        const dot = document.createElement("span");
        dot.className = "activity-color-dot";
        dot.style.backgroundColor = colorHex(activity.color);
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(activity.name));
        btn.addEventListener("click", () => onSelect(activity));
        el.activityButtons.appendChild(btn);
    }
}

function formatMonthLabel(year, month){
    return `${year}年${month}月`;
}

function formatDuration(seconds){
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if(m <= 0) return `${s}秒`;
    return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

function formatDateTimeRange(startIso, endIso){
    const start = new Date(startIso);
    const end = new Date(endIso);
    const pad = n => String(n).padStart(2, "0");
    const day = `${start.getMonth() + 1}/${start.getDate()}`;
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return `${day} ${startTime}〜${endTime}`;
}

// 画面表示用の活動名。保存されているtitle（"活動id:秒数"、カレンダー送信用）はそのまま残し、
// 表示時だけ固定活動項目（DEFAULT_ACTIVITIES）の名前に置き換える。
function historyDisplayTitle(entry){
    const activityId = entry.activityId || String(entry.title || "").split(":")[0];
    const found = DEFAULT_ACTIVITIES.find(a => a.id === activityId);
    return found ? found.name : entry.title;
}

export function renderHistoryMonth(year, month){
    el.currentMonthLabel.textContent = formatMonthLabel(year, month);
}

export function renderHistoryList(entries, { onDelete, onRetry } = {}){
    el.historyList.innerHTML = "";
    el.historyEmptyMessage.hidden = entries.length > 0;
    for(const entry of entries){
        const li = document.createElement("li");
        li.className = "history-item";

        const dot = document.createElement("span");
        dot.className = "history-item-color";
        dot.style.backgroundColor = colorHex(entry.color);
        li.appendChild(dot);

        const body = document.createElement("div");
        body.className = "history-item-body";
        const title = document.createElement("div");
        title.className = "history-item-title";
        title.textContent = historyDisplayTitle(entry);
        const meta = document.createElement("div");
        meta.className = "history-item-meta";
        meta.textContent = `${formatDateTimeRange(entry.date_start, entry.date_end)} ・ ${formatDuration(entry.durationSeconds)}`;
        if(entry.calendarSynced === true) meta.textContent += " ・ カレンダー登録済み";
        if(entry.calendarSynced === false) meta.textContent += " ・ カレンダー未登録";
        body.appendChild(title);
        body.appendChild(meta);
        li.appendChild(body);

        if(entry.calendarSynced === false){
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "history-item-retry";
            retryBtn.textContent = "登録";
            retryBtn.setAttribute("aria-label", "Googleカレンダーに登録する");
            retryBtn.addEventListener("click", () => onRetry(entry.id));
            li.appendChild(retryBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "history-item-delete";
        delBtn.textContent = "×";
        delBtn.setAttribute("aria-label", "この記録を削除");
        delBtn.addEventListener("click", () => onDelete(entry.id));
        li.appendChild(delBtn);

        el.historyList.appendChild(li);
    }
}

export function renderActivityList(activities, { onOpenEdit } = {}){
    el.activityList.innerHTML = "";
    for(const activity of activities){
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "activity-list-item";

        const dot = document.createElement("span");
        dot.className = "activity-color-dot";
        dot.style.backgroundColor = colorHex(activity.color);
        btn.appendChild(dot);

        const name = document.createElement("span");
        name.className = "activity-list-item-name";
        name.textContent = activity.name;
        btn.appendChild(name);

        const type = document.createElement("span");
        type.className = "activity-list-item-type";
        type.textContent = activity.type === "default" ? "固定" : "カスタム";
        btn.appendChild(type);

        btn.addEventListener("click", () => onOpenEdit(activity));
        li.appendChild(btn);
        el.activityList.appendChild(li);
    }
}

export function renderTimerSettings(presets){
    el.timerSettingsFields.innerHTML = "";
    presets.forEach((minutes, i) => {
        const label = document.createElement("label");
        label.textContent = `ボタン${i + 1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.inputMode = "numeric";
        input.min = "1";
        input.max = String(TIMER_MAX_MINUTES);
        input.step = "1";
        input.required = true;
        input.value = String(minutes);
        input.dataset.timerIndex = String(i);
        label.appendChild(input);
        label.appendChild(document.createTextNode("分"));
        el.timerSettingsFields.appendChild(label);
    });
}

export function setShowTimerButtonsField(checked){ el.showTimerButtonsInput.checked = !!checked; }
export function getShowTimerButtonsField(){ return el.showTimerButtonsInput.checked; }

const NOTIFICATION_STATUS_TEXT = {
    granted: "通知: 許可済み",
    denied: "通知: ブロックされています（ブラウザの設定から許可してください）",
    default: "通知: 未許可",
    unsupported: "通知: この環境では利用できません（iPhoneはホーム画面に追加すると利用できます）",
};

export function renderNotificationStatus(permission){
    el.notificationStatus.textContent = NOTIFICATION_STATUS_TEXT[permission] || "";
    el.notificationPermissionBtn.hidden = permission !== "default";
}

export function getTimerSettingsValues(){
    return Array.from(el.timerSettingsFields.querySelectorAll("input"))
        .map(input => Number(input.value));
}

export function setTimerSettingsStatus(text){ el.timerSettingsStatus.textContent = text; }

export function renderColorPicker(selectedColor, onPick){
    el.activityColorPicker.innerHTML = "";
    for(const color of COLOR_PALETTE){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "color-swatch";
        btn.style.backgroundColor = color.hex;
        btn.title = color.label;
        btn.classList.toggle("is-selected", color.value === selectedColor);
        btn.addEventListener("click", () => onPick(color.value));
        el.activityColorPicker.appendChild(btn);
    }
}

export function openActivityDialog({ title, name, color, showDelete }){
    el.activityDialogTitle.textContent = title;
    el.activityNameInput.value = name || "";
    el.activityDeleteBtn.hidden = !showDelete;
    el.activityDialog.showModal();
    el.activityNameInput.focus();
}

export function closeActivityDialog(){
    if(el.activityDialog.open) el.activityDialog.close();
}

export function getActivityDialogName(){
    return el.activityNameInput.value;
}

export const dom = el;
