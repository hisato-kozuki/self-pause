// Googleカレンダーへの予定登録。
//
// カレンダー連動プログラムの main.js `reload_console.postEvents` と同じ通信仕様
// （GASのWebアプリへ `{type: "post", datas: [予定...]}` をPOSTし、応答が "Exception" で
// 始まる場合や `error` を含む場合は失敗とみなす）を、画面（DOM）に依存しない形で切り出したもの。
// カレンダー連動プログラム側のmain.js/class.jsはimportするだけでカレンダーのDOMを
// 操作し始めるため、そのままは読み込めない。
//
// APIのURLはカレンダー連動プログラムと同じlocalStorageキー`apiUrl`に保存する。
// 両アプリを同一オリジンにホストした場合は設定が共有される。

const API_URL_KEY = "apiUrl";

const http_options = {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
};

export function getApiUrl(){
    try{ return localStorage.getItem(API_URL_KEY) || ""; } catch(e){ return ""; }
}

export function setApiUrl(url){
    try{ localStorage.setItem(API_URL_KEY, url); return true; } catch(e){ return false; }
}

// 履歴エントリからカレンダー用の予定データを作る（カレンダー側のregister_consoleと同じキー）。
export function toCalendarEvent(entry){
    return {
        title: entry.title,
        description: entry.description,
        date_start: entry.date_start,
        date_end: entry.date_end,
        color: entry.color,
    };
}

export async function postEvents(events, { timeoutMs = 8000 } = {}){
    const apiUrl = getApiUrl();
    if(!apiUrl) throw new Error("APIのURLが未設定です");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try{
        const response = await fetch(apiUrl, {
            ...http_options,
            body: JSON.stringify({ type: "post", datas: events }),
            signal: controller.signal,
        });
        const text = await response.text();
        if(text.slice(0, 9) === "Exception") throw new Error(text);
        const parsed = JSON.parse(text);
        if(parsed && parsed.error) throw new Error(parsed.error);
        return parsed;
    } finally {
        clearTimeout(timer);
    }
}
