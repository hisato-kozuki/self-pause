// 利用時間タイマーの通知。
//
// - 終了1分前に1回通知する（利用時間が1分以下のセッションでは送らない）。
// - 終了後は、使用可能状態が続く限り10秒ごとに通知を送り続ける。
// - 終了カウントダウンの実行中（ユーザーがアプリに戻って終了しようとしている間）は送らない。
//
// サーバーを持たない構成のため、通知はこのページ自身のタイマーから送る（Push APIは使わない）。
// ページがバックグラウンドにある間はブラウザがタイマーを間引く・停止するため、
// 通知の間隔が延びたり、ページが破棄された後は届かなかったりする。

const WARNING_BEFORE_MS = 60 * 1000;
const REPEAT_INTERVAL_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 1000;
const NOTIFICATION_TAG = "self-pause-timer";

let session = null; // { endsAtMs, totalMs }
let paused = false;
let checkHandle = null;
let warnedEndsAtMs = null; // 1分前通知を済ませたセッション
let lastExpiredNotifyMs = 0;

export function isSupported(){
    return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission(){
    return isSupported() ? Notification.permission : "unsupported";
}

// ユーザー操作（クリック）の中から呼ぶこと。
export async function requestPermission(){
    if(!isSupported()) return "unsupported";
    if(Notification.permission !== "default") return Notification.permission;
    try{
        return await Notification.requestPermission();
    } catch(e){
        return Notification.permission;
    }
}

export function registerServiceWorker(){
    if(!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function show(title, body){
    if(getPermission() !== "granted") return;
    const options = { body, tag: NOTIFICATION_TAG, renotify: true, vibrate: [200, 100, 200] };
    try{
        // Android版Chromeなどは new Notification() を許可せず、Service Worker経由のみ表示できる。
        const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
        if(reg){
            await reg.showNotification(title, options);
            return;
        }
        new Notification(title, options);
    } catch(e){
        // 通知できない環境では何もしない（画面上の残り時間表示で代替する）。
    }
}

function check(){
    if(!session || paused) return;
    const now = Date.now();
    const remainingMs = session.endsAtMs - now;

    if(remainingMs > 0){
        const shouldWarn = remainingMs <= WARNING_BEFORE_MS
            && session.totalMs > WARNING_BEFORE_MS
            && warnedEndsAtMs !== session.endsAtMs;
        if(shouldWarn){
            warnedEndsAtMs = session.endsAtMs;
            show("あと1分です", "利用時間の終了まであと1分です。終わる準備をしましょう。");
        }
        return;
    }

    if(now - lastExpiredNotifyMs >= REPEAT_INTERVAL_MS){
        lastExpiredNotifyMs = now;
        show("利用時間が終了しました", "Self Pauseを開いて、終了の準備を始めましょう。");
    }
}

// 現在のセッション情報を反映する。timer: { timerEndsAt, startedAt } | null
export function update(timer, { paused: isPaused = false } = {}){
    paused = isPaused;
    const endsAtMs = timer && timer.timerEndsAt ? new Date(timer.timerEndsAt).getTime() : NaN;
    if(Number.isNaN(endsAtMs)){
        session = null;
        if(checkHandle){ clearInterval(checkHandle); checkHandle = null; }
        return;
    }
    if(!session || session.endsAtMs !== endsAtMs){
        const startedMs = new Date(timer.startedAt).getTime();
        session = { endsAtMs, totalMs: Number.isNaN(startedMs) ? Infinity : endsAtMs - startedMs };
        lastExpiredNotifyMs = 0;
    }
    if(!checkHandle) checkHandle = setInterval(check, CHECK_INTERVAL_MS);
    check();
}
