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
import { loadState, saveState, isoNow } from "./storage.js";
import { finalizeHistory } from "./history.js";

export const Screen = {
    UNLOCK_COUNTDOWN: "UNLOCK_COUNTDOWN",
    UNLOCKED: "UNLOCKED",
    LOCK_COUNTDOWN: "LOCK_COUNTDOWN",
    ACTIVITY_SELECTION: "ACTIVITY_SELECTION",
    LOCKED_IDLE: "LOCKED_IDLE", // 前面復帰待ちの一瞬だけ通過しうる保険用の状態
};

// 完了アニメーションの再生時間。prefers-reduced-motionの場合は短縮する。
const ANIM_MS = matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 1300;

let state = null;
let countdown = null; // { mode: "UNLOCK" | "LOCK", startedAt: number(ms) }
let completingMode = null;
let completingRunId = null; // 完了アニメーション再生中は次画面への切り替えを保留する
let tickHandle = null;
let animationTimeoutHandle = null;
const listeners = [];

export function onChange(fn){ listeners.push(fn); }
function emit(){ const view = getView(); for(const fn of listeners) fn(view); }

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
        return { screen: Screen.UNLOCKED };
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

// 前面復帰・初回起動時に、必要ならカウントダウンを10秒から開始する。
export function onForeground(){
    // console.log("onForeground")
    stopCountdown();
    clearAnimation();
    if(state.currentState === "LOCKED" && state.pendingHistory){
        emit(); // 活動選択画面を表示するだけで、カウントダウンは開始しない。
        return;
    }
    const mode = state.currentState === "LOCKED" ? "UNLOCK" : "LOCK";
    countdown = { mode, startedAt: Date.now() };
    tickHandle = setInterval(tick, 100);
    emit();
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
    completingRunId = countdown.startedAt;
    stopCountdown();
    const now = isoNow();

    if(mode === "UNLOCK"){
        state.currentState = "UNLOCKED";
        state.lastStateChangedAt = now;
        state.activeSession = { startedAt: now };
        state.pendingHistory = null;
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
