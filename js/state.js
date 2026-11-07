// 状態遷移（docs/state-machine.md）の実装。
//
// 方針:
// - カウントダウンの残り時間はDate.now()基準で毎回計算し直す（setIntervalの回数では数えない）。
// - カウントダウン中の状態（UNLOCK_COUNTDOWN/LOCK_COUNTDOWN）はlocalStorageへ永続化しない。
//   永続化するのはcurrentState（LOCKED/UNLOCKED）が確定した瞬間だけ。
// - hidden（バックグラウンド）や戻る操作ではカウントダウンを破棄するだけで、状態は変更しない。
//   次にvisibleへ戻った時点で10秒から再開する。
//
// 仕様上の補足（実装時の判断）:
// LOCK_COUNTDOWN完了後、直前の活動が未選択のまま（pendingHistoryが残っている）アプリが
// 再起動・再訪問された場合、FR-002の「LOCKEDなら解禁カウントダウンを開始する」をそのまま
// 適用すると、活動を選ばないまま次のセッションが始められてしまう。
// そのため、pendingHistoryが残っている間は活動選択画面（SCR-004）を優先表示し、
// 選択が完了してから解禁カウントダウンを開始する。
//
// 設定でタイマーボタンを有効にしている場合は、解禁カウントダウンを自動では始めず、
// 前面復帰時にまずタイマー選択画面（TIMER_SELECTION）を表示し、利用時間（または制限なし）が
// 選ばれた時点で開始する。無効（既定）の場合は従来どおり、すぐに解禁カウントダウンを始める。
// 選んだ利用時間はUNLOCKEDへの移行完了時刻から計り、経過するとビューのtimerExpiredがtrueになる。
// 利用時間が終わっても状態は変えない（通知はmain.js/notifier.jsが担当する）。
import { loadState, saveState, isoNow } from "./storage.js";
import { finalizeHistory } from "./history.js";

export const Screen = {
    UNLOCK_COUNTDOWN: "UNLOCK_COUNTDOWN",
    UNLOCKED: "UNLOCKED",
    LOCK_COUNTDOWN: "LOCK_COUNTDOWN",
    ACTIVITY_SELECTION: "ACTIVITY_SELECTION",
    TIMER_SELECTION: "TIMER_SELECTION", // 解禁前に利用時間を選ぶ（扉は閉じたまま）
    LOCKED_IDLE: "LOCKED_IDLE", // 活動記録後、次の前面復帰を待つ状態
};

// 完了アニメーションの再生時間。prefers-reduced-motionの場合は短縮する。
const ANIM_MS = matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 1300;

let state = null;
let countdown = null; // { mode: "UNLOCK" | "LOCK", startedAt: number(ms), timerMinutes?: number | null }
let awaitingTimer = false; // 前面復帰後、解禁のためのタイマー選択待ちかどうか
let sessionTimerHandle = null;
let completingMode = null;
let completingRunId = null; // 完了アニメーション再生中は次画面への切り替えを保留する
let tickHandle = null;
let animationTimeoutHandle = null;
const listeners = [];

export function onChange(fn){ listeners.push(fn); }
function emit(){
    syncSessionTimer();
    const view = getView();
    for(const fn of listeners) fn(view);
}

// 使用可能状態でタイマーが設定されている間だけ、残り時間表示のため1秒ごとに再描画する。
function syncSessionTimer(){
    const needed = !countdown && !completingMode
        && state.currentState === "UNLOCKED"
        && !!(state.activeSession && state.activeSession.timerEndsAt);
    if(needed && !sessionTimerHandle){
        sessionTimerHandle = setInterval(emit, 1000);
    } else if(!needed && sessionTimerHandle){
        clearInterval(sessionTimerHandle);
        sessionTimerHandle = null;
    }
}

export function init(){
    state = loadState();
    return state;
}

export function getAppState(){ return state; }

function persist(){ saveState(state); }

// 現在描画すべき画面を、現在の状態から導出する（副作用なしの純粋な計算）。
export function getView(){
    if(countdown){
        const elapsed = Date.now() - countdown.startedAt;
        const totalMs = state.settings.countdownSeconds[countdown.mode] * 1000;
        const remainingMs = Math.max(0, totalMs - elapsed);
        return {
            screen: countdown.mode === "UNLOCK" ? Screen.UNLOCK_COUNTDOWN : Screen.LOCK_COUNTDOWN,
            remainingSeconds: Math.ceil(remainingMs / 1000),
            totalSeconds: state.settings.countdownSeconds[countdown.mode],
            runId: countdown.startedAt,
            completing: false,
        };
    }
    if(completingMode){
        // カウントダウンは完了しているが、演出（扉の開閉）が終わるまでは
        // 見た目上まだ同じ画面のままにしておく。
        return {
            screen: completingMode === "UNLOCK" ? Screen.UNLOCK_COUNTDOWN : Screen.LOCK_COUNTDOWN,
            remainingSeconds: 0,
            totalSeconds: state.settings.countdownSeconds[completingMode],
            runId: completingRunId,
            completing: true,
        };
    }
    if(state.currentState === "LOCKED" && state.pendingHistory){
        return { screen: Screen.ACTIVITY_SELECTION, durationSeconds: state.pendingHistory.durationSeconds };
    }
    if(state.currentState === "UNLOCKED"){
        const session = state.activeSession || {};
        const endsAtMs = session.timerEndsAt ? new Date(session.timerEndsAt).getTime() : NaN;
        if(Number.isNaN(endsAtMs)){
            return { screen: Screen.UNLOCKED, timerEndsAt: null, timerRemainingSeconds: null, timerExpired: false };
        }
        const remainingMs = Math.max(0, endsAtMs - Date.now());
        return {
            screen: Screen.UNLOCKED,
            timerEndsAt: session.timerEndsAt,
            timerRemainingSeconds: Math.ceil(remainingMs / 1000),
            timerExpired: remainingMs <= 0,
        };
    }
    if(awaitingTimer){
        return { screen: Screen.TIMER_SELECTION };
    }
    return { screen: Screen.LOCKED_IDLE };
}

function stopCountdown(){
    countdown = null;
    if(tickHandle){ clearInterval(tickHandle); tickHandle = null; }
}

function clearAnimation(){
    completingMode = null;
    if(animationTimeoutHandle){ clearTimeout(animationTimeoutHandle); animationTimeoutHandle = null; }
}

function startCountdown(mode, extra = {}){
    countdown = { mode, startedAt: Date.now(), ...extra };
    tickHandle = setInterval(tick, 100);
    emit();
}

// 前面復帰・初回起動時の処理。
// - 使用可能状態なら終了カウントダウンを最初から開始する。
// - 使用禁止状態なら、タイマーボタンが有効ならタイマー選択画面を表示し、
//   無効なら解禁カウントダウンを最初から開始する。
export function onForeground(){
    stopCountdown();
    clearAnimation();
    if(state.currentState === "LOCKED" && state.pendingHistory){
        emit(); // 活動選択画面を表示するだけで、カウントダウンは開始しない。
        return;
    }
    if(state.currentState === "LOCKED"){
        if(state.settings.showTimerButtons){
            awaitingTimer = true;
            emit();
        } else {
            awaitingTimer = false;
            startCountdown("UNLOCK", { timerMinutes: null });
        }
        return;
    }
    startCountdown("LOCK");
}

// タイマー選択画面でボタンが押されたときに呼ぶ。minutes: 数値（分）またはnull（制限なし）。
export function startUnlock(minutes){
    if(state.currentState !== "LOCKED" || state.pendingHistory || countdown || completingMode) return;
    const timerMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    startCountdown("UNLOCK", { timerMinutes });
}

// バックグラウンド移行・戻る操作: カウントダウンを破棄するだけで状態は変えない。
export function onInterrupt(){
    if(countdown){
        stopCountdown();
        emit();
    }
}

function tick(){
    // console.log("tick")
    const elapsed = Date.now() - countdown.startedAt;
    const totalMs = state.settings.countdownSeconds[countdown.mode] * 1000;
    if(elapsed >= totalMs){
        completeCountdown();
        return;
    }
    emit();
}

function completeCountdown(){
    const mode = countdown.mode;
    const timerMinutes = countdown.timerMinutes || null;
    completingRunId = countdown.startedAt;
    stopCountdown();
    const now = isoNow();

    if(mode === "UNLOCK"){
        state.currentState = "UNLOCKED";
        state.lastStateChangedAt = now;
        state.activeSession = {
            startedAt: now,
            timerMinutes,
            timerEndsAt: timerMinutes ? new Date(Date.parse(now) + timerMinutes * 60000).toISOString() : null,
        };
        state.pendingHistory = null;
        awaitingTimer = false;
    } else {
        const startedAt = state.activeSession ? state.activeSession.startedAt : now;
        const durationSeconds = Math.max(0, Math.round((new Date(now) - new Date(startedAt)) / 1000));
        state.currentState = "LOCKED";
        state.lastStateChangedAt = now;
        state.activeSession = null;
        state.pendingHistory = { startedAt, endedAt: now, durationSeconds };
    }
    persist();

    // データ上の状態確定は上記で完了済みだが、画面の切り替えは演出が終わるまで保留する。
    completingMode = mode;
    emit();
    animationTimeoutHandle = setTimeout(() => {
        clearAnimation();
        emit();
    }, ANIM_MS);
}

// 使用禁止状態画面で、直前の活動が選ばれたときに呼ぶ。
// 次の解禁カウントダウンをいつ開始するかは呼び出し側（main.js）に委ねる。
// 「記録しました」の確認表示を挟むため、ここでは即座にonForeground()を呼ばない。
export function selectActivity(activity){
    const entry = finalizeHistory(state, activity);
    if(entry) emit();
    return entry;
}

export const ANIMATION_DURATION_MS = ANIM_MS;
