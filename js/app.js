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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
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
if (monthIndex === -1) monthIndex = 0;

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

    if (dateStr === formatDate(today)) {
      cell.classList.add("today");
    }

    calendarGrid.appendChild(cell);
  }

  loadActivityData(year, month);
}

async function loadActivityData(year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  for (const cell of calendarGrid.querySelectorAll(".day-cell.activity")) {
    const dateStr = cell.dataset.date;
    if (!dateStr.startsWith(prefix)) continue;
    const snap = await getDoc(doc(db, "activities", dateStr));
    if (!snap.exists()) continue;
    const data = snap.data();
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
  }
}

async function openDetail(dateStr) {
  currentDateStr = dateStr;
  const d = new Date(dateStr);
  const holidayName = getHolidayName(dateStr);
  const dowStr = DOW_JA[d.getDay()];
  modalDate.textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dowStr}）` +
    (holidayName ? ` 🎌 ${holidayName}` : "");
  detailModal.classList.remove("hidden");

  const snap = await getDoc(doc(db, "activities", dateStr));
  const data = snap.exists() ? snap.data() : {};
  const status = data.status || "予定";

  modalStatus.textContent = status;
  modalStatus.className = `status-mark status-${status}`;
  modalLocationName.textContent = data.location?.name || "（未設定）";
  // 活動内容：複数対応
  const contentList = Array.isArray(data.contentList) && data.contentList.length > 0
    ? data.contentList
    : data.content ? [data.content] : [];
  if (contentList.length === 0) {
    modalContent.innerHTML = "（未設定）";
  } else if (contentList.length === 1) {
    modalContent.textContent = contentList[0];
  } else {
    modalContent.innerHTML = "<ul style='margin:4px 0 0 16px; padding:0;'>" +
      contentList.map(c => `<li>${c}</li>`).join("") + "</ul>";
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

async function loadFeedback(dateStr) {
  feedbackList.innerHTML = "<li>読み込み中...</li>";
  const q = query(
    collection(db, "activities", dateStr, "feedbacks"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
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
  await addDoc(collection(db, "activities", currentDateStr, "feedbacks"), {
    name,
    comment,
    createdAt: serverTimestamp(),
  });
  feedbackForm.reset();
  loadFeedback(currentDateStr);
});

closeModalBtn.addEventListener("click", () => detailModal.classList.add("hidden"));
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) detailModal.classList.add("hidden");
});

prevBtn.addEventListener("click", () => {
  if (monthIndex > 0) { monthIndex--; renderCalendar(); }
});
nextBtn.addEventListener("click", () => {
  if (monthIndex < months.length - 1) { monthIndex++; renderCalendar(); }
});

// カレンダーを即座に表示し、天気データが取れたら再描画
renderCalendar();
fetchWeather().then(() => renderCalendar()).catch(() => {});
