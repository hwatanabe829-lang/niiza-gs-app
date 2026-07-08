import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  orderBy,
  query,
  where,
  limit,
  documentId,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { fetchMonthActivities } from "./store.js";
import {
  getFiscalYearActivityDates,
  getFiscalYearMonths,
  formatDate,
  WEEKDAY_LABELS,
} from "./calendar.js";
import { getHolidayName } from "./holidays.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const activityDates = new Set(getFiscalYearActivityDates());
const months = getFiscalYearMonths();
const today = new Date();
let monthIndex = months.findIndex(
  (m) => m.year === today.getFullYear() && m.month === today.getMonth() + 1
);
// 今月が表示範囲外の場合: 運用開始前なら最初の月、終了後なら最後の月を表示
if (monthIndex === -1) {
  const beforeStart =
    today < new Date(months[0].year, months[0].month - 1, 1);
  monthIndex = beforeStart ? 0 : months.length - 1;
}

const calendarGrid = document.getElementById("calendarGrid");
const monthLabel = document.getElementById("monthLabel");
const prevBtn = document.getElementById("prevMonthBtn");
const nextBtn = document.getElementById("nextMonthBtn");
const detailModal = document.getElementById("detailModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalDate = document.getElementById("modalDate");
const modalStatus = document.getElementById("modalStatus");
const modalLocationName = document.getElementById("modalLocationName");
const modalContent = document.getElementById("modalContent");
const modalNotes = document.getElementById("modalNotes");
const modalParking = document.getElementById("modalParking");
const modalParticipants = document.getElementById("modalParticipants");
const feedbackForm = document.getElementById("feedbackForm");
const feedbackList = document.getElementById("feedbackList");

let map = null;
let marker = null;
let currentDateStr = null;
let weatherCache = new Map(); // dateStr → {max, min, code}

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];

function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "❄️";
  return "⛈️";
}

async function fetchWeather() {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=35.7768&longitude=139.5703" +
      "&hourly=temperature_2m,precipitation_probability,weathercode" +
      "&timezone=Asia%2FTokyo&forecast_days=16";
    const res = await fetch(url);
    const data = await res.json();
    const { time, temperature_2m, precipitation_probability, weathercode } = data.hourly;

    // 9:00〜12:00の時間帯のみ抽出して日付ごとに集計
    const byDate = new Map();
    time.forEach((t, i) => {
      const hour = parseInt(t.slice(11, 13));
      if (hour < 9 || hour > 12) return;
      const date = t.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, { temps: [], probs: [], codes: [] });
      const d = byDate.get(date);
      d.temps.push(temperature_2m[i]);
      d.probs.push(precipitation_probability[i]);
      d.codes.push(weathercode[i]);
    });

    byDate.forEach((d, date) => {
      weatherCache.set(date, {
        code: Math.max(...d.codes),
        minTemp: Math.round(Math.min(...d.temps)),
        maxTemp: Math.round(Math.max(...d.temps)),
        prob: Math.max(...d.probs),
      });
    });
  } catch {
    // API unavailable — calendar still works without weather
  }
}

function renderCalendar() {
  const { year, month } = months[monthIndex];
  monthLabel.textContent = `${year}年${month}月`;
  prevBtn.disabled = monthIndex === 0;
  nextBtn.disabled = monthIndex === months.length - 1;

  calendarGrid.innerHTML = "";

  WEEKDAY_LABELS.forEach((label, i) => {
    const el = document.createElement("div");
    el.className = "weekday";
    if (i === 0) el.classList.add("sun");
    if (i === 6) el.classList.add("sat");
    el.textContent = label;
    calendarGrid.appendChild(el);
  });

  const firstDay = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const startWeekday = firstDay.getDay();

  for (let i = 0; i < startWeekday; i++) {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    calendarGrid.appendChild(el);
  }

  for (let day = 1; day <= lastDate; day++) {
    const d = new Date(year, month - 1, day);
    const dateStr = formatDate(d);
    const dow = d.getDay();
    const holidayName = getHolidayName(dateStr);

    const cell = document.createElement("div");
    cell.className = "day-cell";
    cell.dataset.date = dateStr;
    if (dow === 0) cell.classList.add("sun-cell");
    if (dow === 6) cell.classList.add("sat-cell");
    if (holidayName) cell.classList.add("holiday-cell");

    const num = document.createElement("span");
    num.className = "date-num";
    num.textContent = day;
    cell.appendChild(num);

    if (holidayName) {
      const hEl = document.createElement("div");
      hEl.className = "cell-holiday";
      hEl.textContent = holidayName;
      cell.appendChild(hEl);
    }

    const w = weatherCache.get(dateStr);
    if (w) {
      const wEl = document.createElement("div");
      wEl.className = "cell-weather";
      wEl.textContent = `${weatherEmoji(w.code)} ${w.minTemp}〜${w.maxTemp}° 💧${w.prob}%`;
      cell.appendChild(wEl);
    }

    if (activityDates.has(dateStr)) {
      cell.classList.add("activity");
      cell.addEventListener("click", () => openDetail(dateStr));
    }

    const todayStr = formatDate(today);
    if (dateStr === todayStr) {
      cell.classList.add("today");
    } else if (dateStr < todayStr) {
      // 過ぎた日は薄くして、これからの活動日が目立つように（感想投稿のためクリックは可能）
      cell.classList.add("past");
    }

    calendarGrid.appendChild(cell);
  }

  loadMonthActivities(year, month);
}

// ============================================================
// 次回の活動ヒーローカード
// ページを開いた人が一番知りたい「次はいつ・どこ」を最上部に表示する
// ============================================================
const nextActivityCard = document.getElementById("nextActivityCard");

function daysUntilLabel(dateStr) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d - base) / 86400000);
  if (diff === 0) return "本日";
  if (diff === 1) return "明日";
  return `あと${diff}日`;
}

function heroDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}月${d.getDate()}日（${DOW_JA[d.getDay()]}）`;
}

async function renderNextActivity() {
  if (!nextActivityCard) return;
  const todayStr = formatDate(new Date());
  let dateStr = null;
  let data = {};
  let followup = null; // 次回が中止・延期のとき、その次の開催候補

  try {
    // 登録済みデータから今日以降の直近の活動日を取得（振替日も含まれる）
    const snap = await getDocs(query(
      collection(db, "activities"),
      where(documentId(), ">=", todayStr),
      orderBy(documentId()),
      limit(5)
    ));
    if (!snap.empty) {
      dateStr = snap.docs[0].id;
      data = snap.docs[0].data();
      const status = data.status || "予定";
      if (status === "中止" || status === "延期") {
        const next = snap.docs.slice(1).find((x) => {
          const s = x.data().status || "予定";
          return s !== "中止" && s !== "延期";
        });
        if (next) followup = next.id;
      }
    }
  } catch {
    // Firestoreが読めなくても下のフォールバックで表示する
  }

  if (!dateStr) {
    // データ未登録でも活動日ルール（第一水曜＋第二以降の木曜）から次回を出す
    const sorted = [...activityDates].sort();
    dateStr = activityDates.has(todayStr) ? todayStr : (sorted.find((s) => s > todayStr) || null);
    data = {};
  }
  if (!dateStr) {
    nextActivityCard.classList.add("hidden");
    return;
  }

  const status = data.status || "予定";
  const cancelled = status === "中止" || status === "延期";
  nextActivityCard.classList.toggle("cancelled", cancelled);
  nextActivityCard.innerHTML = "";

  const title = document.createElement("div");
  title.className = "na-title";
  title.textContent = dateStr === todayStr ? "🌱 本日は活動日です！" : "🌱 次回の活動";
  nextActivityCard.appendChild(title);

  const main = document.createElement("div");
  main.className = "na-main";
  const dateEl = document.createElement("span");
  dateEl.className = "na-date";
  dateEl.textContent = heroDateLabel(dateStr);
  main.appendChild(dateEl);
  const countEl = document.createElement("span");
  countEl.className = "na-count";
  countEl.textContent = cancelled ? status : daysUntilLabel(dateStr);
  main.appendChild(countEl);
  nextActivityCard.appendChild(main);

  const infoBits = [];
  if (data.location?.name) infoBits.push("📍 " + data.location.name);
  const contentList = Array.isArray(data.contentList) && data.contentList.length > 0
    ? data.contentList
    : data.content ? [data.content] : [];
  if (contentList.length) infoBits.push("✂️ " + contentList.join("・"));
  if (data.parking) infoBits.push("🅿 駐車可");
  const w = weatherCache.get(dateStr);
  if (w) infoBits.push(`${weatherEmoji(w.code)} ${w.minTemp}〜${w.maxTemp}° 💧${w.prob}%`);
  if (infoBits.length) {
    const info = document.createElement("div");
    info.className = "na-info";
    info.textContent = infoBits.join("　");
    nextActivityCard.appendChild(info);
  }

  if (cancelled) {
    const note = document.createElement("div");
    note.className = "na-followup";
    note.textContent = status === "延期" && data.rescheduleDate
      ? `🔄 ${heroDateLabel(data.rescheduleDate)}に振替予定です`
      : followup
        ? `次の開催予定: ${heroDateLabel(followup)}`
        : "次の開催日はカレンダーでご確認ください";
    nextActivityCard.appendChild(note);
  }

  const hint = document.createElement("div");
  hint.className = "na-tap-hint";
  hint.textContent = "タップで詳細・地図を表示 ▶";
  nextActivityCard.appendChild(hint);

  nextActivityCard.onclick = () => openDetail(dateStr);
  nextActivityCard.classList.remove("hidden");
}

// 月送り連打時に古い読み込み結果を破棄するためのトークン
let loadToken = 0;

async function loadMonthActivities(year, month) {
  const token = ++loadToken;
  let monthData;
  try {
    monthData = await fetchMonthActivities(db, year, month);
  } catch {
    return; // 取得失敗でもカレンダー自体は表示済み
  }
  if (token !== loadToken) return;

  for (const cell of calendarGrid.querySelectorAll(".day-cell[data-date]")) {
    const dateStr = cell.dataset.date;
    const data = monthData.get(dateStr);
    if (!data) continue;
    if (cell.classList.contains("activity")) {
      decorateActivityCell(cell, data);
    } else if (data.isReschedule) {
      // 振替日として追加された活動日
      cell.classList.add("activity");
      cell.style.borderColor = "var(--orange)";
      cell.style.background = "#fff8e1";
      const mark = document.createElement("div");
      mark.className = "cell-reschedule";
      mark.textContent = "🔄 振替活動日";
      cell.appendChild(mark);
      cell.addEventListener("click", () => openDetail(dateStr));
    }
  }
}

function decorateActivityCell(cell, data) {
  const status = data.status || "予定";

  const mark = document.createElement("span");
  mark.className = `status-mark status-${status}`;
  mark.textContent = status;
  cell.appendChild(mark);

  if (data.location?.name) {
    const locEl = document.createElement("div");
    locEl.className = "cell-location";
    locEl.textContent = "📍 " + data.location.name;
    cell.appendChild(locEl);
  }

  if (data.parking) {
    const pEl = document.createElement("div");
    pEl.className = "cell-parking";
    pEl.textContent = "🅿 駐車可";
    cell.appendChild(pEl);
  }

  if ((status === "実施" || status === "予定") && data.participants) {
    const ptEl = document.createElement("div");
    ptEl.className = "cell-participants";
    ptEl.textContent = "👥 " + data.participants + "名";
    cell.appendChild(ptEl);
  }

  if (data.notes) {
    const nEl = document.createElement("div");
    nEl.className = "cell-notes-alert";
    nEl.textContent = "⚠️ 注意あり";
    cell.appendChild(nEl);
  }

  if (status === "延期" && data.rescheduleDate) {
    const rEl = document.createElement("div");
    rEl.className = "cell-reschedule";
    const rd = new Date(data.rescheduleDate + "T00:00:00");
    rEl.textContent = `🔄 振替: ${rd.getMonth() + 1}/${rd.getDate()}`;
    cell.appendChild(rEl);
  }
}

// 日付を連打したとき、遅れて届いた古い日のデータで表示が上書きされるのを防ぐ
let detailToken = 0;

async function openDetail(dateStr) {
  currentDateStr = dateStr;
  const token = ++detailToken;
  const d = new Date(dateStr + "T00:00:00");
  const holidayName = getHolidayName(dateStr);
  const dowStr = DOW_JA[d.getDay()];
  modalDate.textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dowStr}）` +
    (holidayName ? ` 🎌 ${holidayName}` : "");

  // 前回開いた日のデータが一瞬見えないよう、読み込み前にクリアする
  modalStatus.textContent = "";
  modalStatus.className = "status-mark";
  modalLocationName.textContent = "読み込み中...";
  modalContent.textContent = "";
  modalNotes.textContent = "";
  document.getElementById("modalReschedule").classList.add("hidden");
  document.getElementById("modalParkingSection").classList.add("hidden");
  document.getElementById("modalParticipantsSection").classList.add("hidden");
  feedbackList.innerHTML = "";
  detailModal.classList.remove("hidden");

  let data = {};
  try {
    const snap = await getDoc(doc(db, "activities", dateStr));
    if (token !== detailToken) return; // すでに別の日を開いている
    data = snap.exists() ? snap.data() : {};
  } catch {
    if (token !== detailToken) return;
    modalLocationName.textContent = "（読み込みに失敗しました。通信環境をご確認ください）";
    return;
  }
  const status = data.status || "予定";

  modalStatus.textContent = status;
  modalStatus.className = `status-mark status-${status}`;

  // 振替日表示
  const rescheduleEl = document.getElementById("modalReschedule");
  if (status === "延期" && data.rescheduleDate) {
    const rd = new Date(data.rescheduleDate + "T00:00:00");
    rescheduleEl.textContent = `🔄 振替予定日: ${rd.getFullYear()}年${rd.getMonth() + 1}月${rd.getDate()}日`;
    rescheduleEl.classList.remove("hidden");
  } else {
    rescheduleEl.classList.add("hidden");
  }

  // 天気予報表示
  const weatherEl = document.getElementById("modalWeather");
  const w = weatherCache.get(dateStr);
  if (w) {
    weatherEl.innerHTML = `<strong>当日の天気予報（9〜12時）</strong>: ${weatherEmoji(w.code)} ${w.minTemp}〜${w.maxTemp}℃ 💧降水確率${w.prob}%`;
    weatherEl.classList.remove("hidden");
  } else {
    weatherEl.classList.add("hidden");
  }

  modalLocationName.textContent = data.location?.name || "（未設定）";
  // 活動内容：複数対応
  const contentList = Array.isArray(data.contentList) && data.contentList.length > 0
    ? data.contentList
    : data.content ? [data.content] : [];
  if (contentList.length === 0) {
    modalContent.textContent = "（未設定）";
  } else if (contentList.length === 1) {
    modalContent.textContent = contentList[0];
  } else {
    const ul = document.createElement("ul");
    ul.style.cssText = "margin:4px 0 0 16px; padding:0;";
    contentList.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    });
    modalContent.textContent = "";
    modalContent.appendChild(ul);
  }
  modalNotes.textContent = data.notes || "（未設定）";

  const parkingSection = document.getElementById("modalParkingSection");
  if (data.parking) {
    parkingSection.classList.remove("hidden");
    modalParking.textContent = "🅿 駐車場あり";
  } else {
    parkingSection.classList.add("hidden");
  }

  const partSection = document.getElementById("modalParticipantsSection");
  if (data.participants) {
    partSection.classList.remove("hidden");
    modalParticipants.textContent = "👥 参加人数: " + data.participants + "名";
  } else {
    partSection.classList.add("hidden");
  }

  renderMap(data.location);
  loadFeedback(dateStr);
}

function renderMap(location) {
  const mapEl = document.getElementById("map");
  mapEl.style.display = location?.lat ? "" : "none";
  if (!location?.lat) return;
  if (!map) {
    map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }
  map.setView([location.lat, location.lng], 16);
  if (marker) marker.remove();
  marker = L.marker([location.lat, location.lng]).addTo(map);
  setTimeout(() => map.invalidateSize(), 100);
}

let feedbackToken = 0;

async function loadFeedback(dateStr) {
  const token = ++feedbackToken;
  feedbackList.innerHTML = "<li>読み込み中...</li>";
  let snap;
  try {
    snap = await getDocs(query(
      collection(db, "activities", dateStr, "feedbacks"),
      orderBy("createdAt", "desc")
    ));
  } catch {
    if (token !== feedbackToken) return;
    feedbackList.innerHTML = "<li>感想の読み込みに失敗しました</li>";
    return;
  }
  if (token !== feedbackToken) return;
  feedbackList.innerHTML = "";
  if (snap.empty) {
    feedbackList.innerHTML = "<li>まだ感想はありません</li>";
    return;
  }
  snap.forEach((d) => {
    const item = d.data();
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "feedback-name";
    nameSpan.textContent = item.name || "匿名";
    li.appendChild(nameSpan);
    li.appendChild(document.createTextNode(item.comment));
    feedbackList.appendChild(li);
  });
}

feedbackForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("feedbackName").value.trim();
  const comment = document.getElementById("feedbackComment").value.trim();
  if (!comment) return;
  const submitBtn = feedbackForm.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "投稿中...";
  try {
    await addDoc(collection(db, "activities", currentDateStr, "feedbacks"), {
      name,
      comment,
      createdAt: serverTimestamp(),
    });
    feedbackForm.reset();
    loadFeedback(currentDateStr);
  } catch {
    alert("投稿に失敗しました。通信環境をご確認のうえ、もう一度お試しください。");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "投稿する";
  }
});

closeModalBtn.addEventListener("click", () => detailModal.classList.add("hidden"));
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) detailModal.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") detailModal.classList.add("hidden");
});

prevBtn.addEventListener("click", () => {
  if (monthIndex > 0) { monthIndex--; renderCalendar(); }
});
nextBtn.addEventListener("click", () => {
  if (monthIndex < months.length - 1) { monthIndex++; renderCalendar(); }
});

// カレンダーとヒーローカードを即座に表示し、天気データが取れたら再描画
renderCalendar();
renderNextActivity();
fetchWeather().then(() => {
  renderCalendar();
  renderNextActivity();
}).catch(() => {});
