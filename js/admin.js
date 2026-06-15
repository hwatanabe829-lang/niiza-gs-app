import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  getFiscalYearActivityDates,
  getFiscalYearMonths,
  formatDate,
  WEEKDAY_LABELS,
} from "./calendar.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const activityDates = new Set(getFiscalYearActivityDates());
const months = getFiscalYearMonths();
const today = new Date();
let monthIndex = months.findIndex(
  (m) => m.year === today.getFullYear() && m.month === today.getMonth() + 1
);
if (monthIndex === -1) monthIndex = 0;

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const adminPanel = document.getElementById("adminPanel");
const loggedInUser = document.getElementById("loggedInUser");
const logoutBtn = document.getElementById("logoutBtn");
const setupBtn = document.getElementById("setupBtn");
const setupResult = document.getElementById("setupResult");

const calendarGrid = document.getElementById("calendarGrid");
const monthLabel = document.getElementById("monthLabel");
const prevBtn = document.getElementById("prevMonthBtn");
const nextBtn = document.getElementById("nextMonthBtn");

const editModal = document.getElementById("editModal");
const closeEditBtn = document.getElementById("closeEditBtn");
const editDate = document.getElementById("editDate");
const editForm = document.getElementById("editForm");
const editStatus = document.getElementById("editStatus");
const editLocationName = document.getElementById("editLocationName");
const editContent = document.getElementById("editContent");
const editNotes = document.getElementById("editNotes");
const editLatLng = document.getElementById("editLatLng");
const saveResult = document.getElementById("saveResult");

let currentDateStr = null;
let currentLocation = null;
let adminMap = null;
let adminMarker = null;

// --- 認証 ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "ログインに失敗しました: " + err.message;
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginCard.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    loggedInUser.textContent = `ログイン中: ${user.email}`;
    renderCalendar();
  } else {
    loginCard.classList.remove("hidden");
    adminPanel.classList.add("hidden");
  }
});

// --- 初回セットアップ ---
setupBtn.addEventListener("click", async () => {
  setupResult.textContent = "登録中...";
  let created = 0;
  for (const dateStr of activityDates) {
    const ref = doc(db, "activities", dateStr);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        date: dateStr,
        status: "予定",
        location: { name: "", lat: null, lng: null },
        content: "",
        notes: "",
      });
      created++;
    }
  }
  setupResult.textContent = `完了: ${created}件の活動日を新規登録しました(対象 全${activityDates.size}件)。`;
  renderCalendar();
});

// --- カレンダー ---
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
      cell.addEventListener("click", () => openEdit(dateStr));
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

// --- 編集モーダル ---
async function openEdit(dateStr) {
  currentDateStr = dateStr;
  saveResult.textContent = "";
  editDate.textContent = dateStr;

  const snap = await getDoc(doc(db, "activities", dateStr));
  const data = snap.exists() ? snap.data() : {};

  editStatus.value = data.status || "予定";
  editLocationName.value = data.location?.name || "";
  editContent.value = data.content || "";
  editNotes.value = data.notes || "";
  currentLocation = data.location?.lat
    ? { lat: data.location.lat, lng: data.location.lng }
    : null;

  updateLatLngLabel();
  editModal.classList.remove("hidden");

  setTimeout(() => initAdminMap(currentLocation), 100);
}

function updateLatLngLabel() {
  editLatLng.textContent = currentLocation
    ? `緯度・経度: ${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)}`
    : "緯度・経度: 未設定(地図をクリックしてください)";
}

function initAdminMap(location) {
  const center = location ? [location.lat, location.lng] : [35.7768, 139.5703]; // 新座市付近
  if (!adminMap) {
    adminMap = L.map("admin-map").setView(center, location ? 16 : 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(adminMap);
    adminMap.on("click", (e) => {
      currentLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
      updateLatLngLabel();
      if (adminMarker) adminMarker.remove();
      adminMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(adminMap);
    });
  } else {
    adminMap.setView(center, location ? 16 : 13);
  }

  if (adminMarker) {
    adminMarker.remove();
    adminMarker = null;
  }
  if (location) {
    adminMarker = L.marker(center).addTo(adminMap);
  }
  setTimeout(() => adminMap.invalidateSize(), 100);
}

closeEditBtn.addEventListener("click", () => editModal.classList.add("hidden"));
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) editModal.classList.add("hidden");
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveResult.textContent = "保存中...";

  await setDoc(
    doc(db, "activities", currentDateStr),
    {
      date: currentDateStr,
      status: editStatus.value,
      location: {
        name: editLocationName.value.trim(),
        lat: currentLocation?.lat ?? null,
        lng: currentLocation?.lng ?? null,
      },
      content: editContent.value.trim(),
      notes: editNotes.value.trim(),
    },
    { merge: true }
  );

  saveResult.textContent = "保存しました。";
  renderCalendar();
});
