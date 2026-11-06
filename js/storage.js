// localStorageへの読み書きと、破損データ・未保存・スキーマ移行への対応をまとめたモジュール。
// docs/data-design.md の設計に、カレンダー連動プログラムとの互換用フィールド名を反映している。

const STORAGE_KEY = "selfPause.appState";
const SCHEMA_VERSION = 1.3;
const LOCK_COUNTDOWN_SECONDS = 6;
const UNLOCK_COUNTDOWN_SECONDS = 4;
const DEFAULT_RETENTION_DAYS = 365;
// 解禁前に選ぶタイマーの選択肢（分）。6つ目のボタンは常に「制限なし」。
const DEFAULT_TIMER_PRESETS = [5, 15, 30, 60, 120];
const TIMER_PRESET_COUNT = DEFAULT_TIMER_PRESETS.length;
export const TIMER_MAX_MINUTES = 1440;

// 固定の活動項目。colorはカレンダー連動プログラムのcolorCodesに合わせた値。
const DEFAULT_ACTIVITIES = [
    { id: "activity-game", name: "ゲーム", color: "7" },
    { id: "activity-tv", name: "テレビ", color: "9" },
    { id: "activity-video", name: "Youtube", color: "3" },
    { id: "activity-sns", name: "SNS", color: "6" },
    { id: "activity-book", name: "読書", color: "2" },
    { id: "activity-other", name: "その他", color: "8" },
];

function nowIso(){
    return new Date().toISOString();
}

function generateId(prefix){
    if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"){
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultActivities(createdAt){
    return DEFAULT_ACTIVITIES.map(a => ({
        id: a.id,
        name: a.name,
        type: "default",
        color: a.color,
        isDeleted: false,
        createdAt,
        updatedAt: createdAt,
    }));
}

export function isValidTimerPresets(presets){
    return Array.isArray(presets)
        && presets.length === TIMER_PRESET_COUNT
        && presets.every(m => Number.isInteger(m) && m >= 1 && m <= TIMER_MAX_MINUTES);
}

function createDefaultState(){
    const createdAt = nowIso();
    return {
        schemaVersion: SCHEMA_VERSION,
        currentState: "LOCKED",
        lastStateChangedAt: createdAt,
        activeSession: null,
        pendingHistory: null,
        activities: createDefaultActivities(createdAt),
        history: [],
        settings: {
            historyRetentionDays: DEFAULT_RETENTION_DAYS,
            countdownSeconds: {
                LOCK: LOCK_COUNTDOWN_SECONDS,
                UNLOCK: UNLOCK_COUNTDOWN_SECONDS,
            },
            timerPresets: [...DEFAULT_TIMER_PRESETS],
            // 既定では起動時にボタンを表示せず、すぐに解禁カウントダウンを始める。
            showTimerButtons: false,
        },
    };
}

function isValidState(data){
    return !!data
        && typeof data === "object"
        && typeof data.schemaVersion === "number"
        && (data.currentState === "LOCKED" || data.currentState === "UNLOCKED")
        && Array.isArray(data.activities)
        && Array.isArray(data.history)
        && data.settings && typeof data.settings === "object";
}

// スキーマバージョンごとの変換。古いバージョンから順に適用する。
function migrate(data){
    if(data.schemaVersion < 1.1){
        // v1.1で固定活動項目の名称・色を変更したため、既定の6項目に置き換える。
        data.activities = createDefaultActivities(nowIso());
    }
    if(typeof data.settings.historyRetentionDays !== "number") data.settings.historyRetentionDays = DEFAULT_RETENTION_DAYS;
    if(!data.settings.countdownSeconds || typeof data.settings.countdownSeconds !== "object") data.settings.countdownSeconds = {LOCK: LOCK_COUNTDOWN_SECONDS, UNLOCK: UNLOCK_COUNTDOWN_SECONDS};
    // v1.2: タイマーの選択肢を追加
    if(!isValidTimerPresets(data.settings.timerPresets)) data.settings.timerPresets = [...DEFAULT_TIMER_PRESETS];
    // v1.3: 起動時のタイマーボタン表示（既定はオフ）
    if(typeof data.settings.showTimerButtons !== "boolean") data.settings.showTimerButtons = false;
    if(data.pendingHistory === undefined) data.pendingHistory = null;
    if(data.activeSession === undefined) data.activeSession = null;
    data.schemaVersion = SCHEMA_VERSION;
    return data;
}

let memoryState = null; // localStorageが使えない環境向けのフォールバック（保存はされない）
let storageWarning = null;

function readRaw(){
    try{
        return localStorage.getItem(STORAGE_KEY);
    } catch(e){
        storageWarning = "この端末ではlocalStorageが利用できないため、記録は保存されません。";
        return undefined; // アクセス不可（未保存とは区別する）
    }
}

export function loadState(){
    const raw = readRaw();
    if(raw === undefined){
        return memoryState || (memoryState = createDefaultState());
    }
    if(raw == null){
        const fresh = createDefaultState();
        saveState(fresh);
        return fresh;
    }
    try{
        const data = JSON.parse(raw);
        if(!isValidState(data)) throw new Error("invalid shape");
        return migrate(data);
    } catch(e){
        storageWarning = "保存データが壊れていたため初期化しました。これまでの履歴が失われた可能性があります。";
        const fresh = createDefaultState();
        saveState(fresh);
        return fresh;
    }
}

export function saveState(state){
    memoryState = state;
    try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e){
        storageWarning = "端末の空き容量不足などにより保存に失敗しました。";
    }
}

export function getStorageWarning(){ return storageWarning; }
export function clearStorageWarning(){ storageWarning = null; }
export function isoNow(){ return nowIso(); }
export { generateId, STORAGE_KEY, SCHEMA_VERSION, DEFAULT_ACTIVITIES };
