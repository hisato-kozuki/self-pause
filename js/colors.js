// カレンダー連動プログラム（class.js）のcolorCodesと同じ配色・並び順。
// Self Pauseの活動履歴はこの値をそのまま`color`フィールドとして保存するため、
// カレンダーアプリ側でそのまま同じ色で表示できる。
export const COLOR_PALETTE = [
    { value: "8", label: "灰", hex: "#616161" },
    { value: "7", label: "シアン", hex: "#039BE5" },
    { value: "11", label: "赤", hex: "#D50000" },
    { value: "4", label: "ピンク", hex: "#E67C73" },
    { value: "1", label: "紫", hex: "#7986CB" },
    { value: "9", label: "青", hex: "#3F51B5" },
    { value: "3", label: "ブドウ", hex: "#8E24AA" },
    { value: "5", label: "黄", hex: "#F6BF26" },
    { value: "2", label: "緑", hex: "#33B679" },
    { value: "6", label: "朱", hex: "#F4511E" },
    { value: "10", label: "深緑", hex: "#0B8043" },
];

export function colorHex(value){
    const found = COLOR_PALETTE.find(c => c.value === String(value));
    return found ? found.hex : "#616161";
}
