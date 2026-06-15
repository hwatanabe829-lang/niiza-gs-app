// 令和8年度(2026年4月〜2027年3月)のGS活動日生成ロジック
// ルール: 各月の「第一水曜日」1日 + 「第二以降の木曜日」(第2,3,4,5木曜)

export const FISCAL_YEAR_START = { year: 2026, month: 4 }; // 令和8年度開始月
export const FISCAL_YEAR_MONTHS = 12;

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

// 令和8年度(2026-04 〜 2027-03)の全活動日をYYYY-MM-DD文字列の配列で返す
export function getFiscalYearActivityDates() {
  const result = [];
  let { year, month } = FISCAL_YEAR_START;

  for (let i = 0; i < FISCAL_YEAR_MONTHS; i++) {
    const dates = getActivityDatesInMonth(year, month);
    dates.forEach((d) => result.push(formatDate(d)));

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return result;
}

// 令和8年度の月一覧を {year, month} の配列で返す(カレンダー表示の月送り用)
export function getFiscalYearMonths() {
  const months = [];
  let { year, month } = FISCAL_YEAR_START;
  for (let i = 0; i < FISCAL_YEAR_MONTHS; i++) {
    months.push({ year, month });
    month++;
    if (month > 12) {
      month = 1;
      year++;
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
