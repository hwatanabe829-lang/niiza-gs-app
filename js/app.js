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
const feedbackForm = document.getElementById("feedbackForm");
const feedbackList = document.getElementById("feedbackList");

let map = null;
let marker = null;
let currentDateStr = null;

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
    const dateStr = formatDate(new Date(year, month - 1, day));
    const cell = document.createElement("div");
    cell.className = "day-cell";

    const num = document.createElement("div");
    num.className = "date-num";
    num.textContent = day;
    cell.appendChild(num);

    if (activityDates.has(dateStr)) {
      cell.classList.add("activity");
      cell.dataset.date = dateStr;
      cell.addEventListener("click", () => openDetail(dateStr));
    }

    calendarGrid.appendChild(cell);
  }

  if (activityDates.size) {
    loadStatusMarks(year, month);
  }
}

async function loadStatusMarks(year, month) {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  for (const cell of calendarGrid.querySelectorAll(".day-cell.activity")) {
    const dateStr = cell.dataset.date;
    if (!dateStr.startsWith(monthPrefix)) continue;
    const snap = await getDoc(doc(db, "activities", dateStr));
    const status = snap.exists() ? snap.data().status || "予定" : "予定";
    const mark = document.createElement("span");
    mark.className = `status-mark status-${status}`;
    mark.textContent = status;
    cell.appendChild(mark);
  }
}

async function openDetail(dateStr) {
  currentDateStr = dateStr;
  modalDate.textContent = dateStr;
  detailModal.classList.remove("hidden");

  const snap = await getDoc(doc(db, "activities", dateStr));
  const data = snap.exists() ? snap.data() : {};
  const status = data.status || "予定";

  modalStatus.textContent = status;
  modalStatus.className = `status-mark status-${status}`;
  modalLocationName.textContent = data.location?.name || "(未設定)";
  modalContent.textContent = data.content || "(未設定)";
  modalNotes.textContent = data.notes || "(未設定)";

  renderMap(data.location);
  loadFeedback(dateStr);
}

function renderMap(location) {
  const mapEl = document.getElementById("map");
  mapEl.style.display = location?.lat ? "" : "none";

  if (!location?.lat) return;

  if (!map) {
    map = L.map("map");
  }
  map.setView([location.lat, location.lng], 16);
  if (marker) marker.remove();
  marker = L.marker([location.lat, location.lng]).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
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
    const data = d.data();
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "feedback-name";
    nameSpan.textContent = data.name || "匿名";
    li.appendChild(nameSpan);
    li.appendChild(document.createTextNode(data.comment));
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

closeModalBtn.addEventListener("click", () => {
  detailModal.classList.add("hidden");
});

detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) detailModal.classList.add("hidden");
});

prevBtn.addEventListener("click", () => {
  if (monthIndex > 0) {
    monthIndex--;
    renderCalendar();
  }
});

nextBtn.addEventListener("click", () => {
  if (monthIndex < months.length - 1) {
    monthIndex++;
    renderCalendar();
  }
});

renderCalendar();
