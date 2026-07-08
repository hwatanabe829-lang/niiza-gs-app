// GS活動日生成ロジック
// ルール: 各月の「第一水曜日」1日 + 「第二以降の木曜日」(第2,3,4,5木曜)
// 年度(4月〜翌3月)をまたいでも動作し、緑地などの設定はそのまま引き継がれる

// アプリ運用開始年度(令和8年度 = 2026年度)。これより前の年度は表示しない
export const FIRST_FISCAL_YEAR = 2026;

// 指定日が属する年度(4月始まり)を返す
export function getFiscalYear(d = new Date()) {
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

// 表示・登録対象の年度一覧(運用開始年度 〜 今年度+1)。
// 「+1」は年度末に翌年度の活動日を先に準備できるようにするため
export function getAvailableFiscalYears() {
  const last = Math.max(FIRST_FISCAL_YEAR, getFiscalYear()) + 1;
  const years = [];
  for (let y = FIRST_FISCAL_YEAR; y <= last; y++) years.push(y);
  return years;
}

// 年度を「令和N年度」表記にする
export function fiscalYearLabel(fy) {
  return `令和${fy - 2018}年度`;
}

// 指定年月(month: 1-12)の全日付からGS活動日(Date配列)を抽出
function getActivityDatesInMonth(year, month) {
  const dates = [];
  const lastDay = new Date(year, month, 0).getDate();

  let firstWednesday = null;
  const thursdays = [];

  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month - 1, day);
    const dow = d.getDay(); // 0:日 ... 3:水 4:木
    if (dow === 3 && firstWednesday === null) {
      firstWednesday = d;
    }
    if (dow === 4) {
      thursdays.push(d);
    }
  }

  if (firstWednesday) dates.push(firstWednesday);
  // 第二以降の木曜日(最初の木曜を除く)
  thursdays.slice(1).forEach((d) => dates.push(d));

  // 日付順にソート
  dates.sort((a, b) => a - b);
  return dates;
}

// 指定年度(4月〜翌3月)の活動日をYYYY-MM-DD文字列の配列で返す
export function getActivityDatesForFiscalYear(fy) {
  const result = [];
  let year = fy;
  let month = 4;
  for (let i = 0; i < 12; i++) {
    getActivityDatesInMonth(year, month).forEach((d) => result.push(formatDate(d)));
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return result;
}

// 表示対象の全年度分の活動日をYYYY-MM-DD文字列の配列で返す
export function getFiscalYearActivityDates() {
  return getAvailableFiscalYears().flatMap((fy) => getActivityDatesForFiscalYear(fy));
}

// 表示対象の全ての月一覧を {year, month} の配列で返す(カレンダー表示の月送り用)
export function getFiscalYearMonths() {
  const months = [];
  for (const fy of getAvailableFiscalYears()) {
    let year = fy;
    let month = 4;
    for (let i = 0; i < 12; i++) {
      months.push({ year, month });
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }
  return months;
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
