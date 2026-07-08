import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  deleteField,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { fetchMonthActivities, fetchActivityIdsInRange } from "./store.js";
import {
  getFiscalYearActivityDates,
  getFiscalYearMonths,
  getActivityDatesForFiscalYear,
  getAvailableFiscalYears,
  getFiscalYear,
  fiscalYearLabel,
  formatDate,
  WEEKDAY_LABELS,
} from "./calendar.js";
import { getHolidayName } from "./holidays.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 各職員の端末ごとにログイン状態を保持する
// （現場で開くたびにパスワードを入れ直さなくて済むように。ログアウトボタンで解除可能）
setPersistence(auth, browserLocalPersistence);

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

// 設定キャッシュ
let locationsList = [];    // [{id, name, lat, lng}]
let activityTypesList = []; // [string]
let cityStaffList = [];     // [string]

// 編集状態
let currentDateStr = null;
let currentLocation = null;
let editContentItems = [];      // 活動内容リスト（複数）
let editCityParticipants = [];  // 市側参加者リスト（複数）
let adminMap = null;
let adminMarker = null;
let locMap = null;      // 場所設定フォーム用地図
let locMapMarker = null;

// DOM refs
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
const statusBtnGroup = document.getElementById("statusBtnGroup");
const editLocationSelect = document.getElementById("editLocationSelect");
const editLocationName = document.getElementById("editLocationName");
const editActivityTypeSelect = document.getElementById("editActivityTypeSelect");
const editContentInput = document.getElementById("editContentInput");
const editNotes = document.getElementById("editNotes");
const editParking = document.getElementById("editParking");
const editParticipants = document.getElementById("editParticipants");
const editAdminComment = document.getElementById("editAdminComment");
const editRescheduleDate = document.getElementById("editRescheduleDate");
const rescheduleField = document.getElementById("rescheduleField");
const saveResult = document.getElementById("saveResult");
const deleteEventBtn = document.getElementById("deleteEventBtn");

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];

// ============================================================
// 認証
// ============================================================
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(
      auth,
      "hwatanabe829@gmail.com",
      document.getElementById("loginPassword").value
    );
  } catch (err) {
    loginError.textContent = "ログインに失敗しました: " + err.message;
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginCard.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    loggedInUser.textContent = `ログイン中: ${user.email}`;
    await loadSettings();
    renderCalendar();
  } else {
    loginCard.classList.remove("hidden");
    adminPanel.classList.add("hidden");
  }
});

// ============================================================
// 場所設定フォーム用 地図（手動クリックで座標をセット）
// ============================================================
function initLocMap() {
  if (locMap) { locMap.invalidateSize(); return; }
  // 新座市中心座標
  locMap = L.map("loc-map").setView([35.7768, 139.5703], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(locMap);

  locMap.on("click", (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById("locLat").value = lat.toFixed(6);
    document.getElementById("locLng").value = lng.toFixed(6);
    const resultEl = document.getElementById("locGeocodeResult");
    resultEl.textContent = `📍 地図から選択: (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    resultEl.style.color = "green";
    if (locMapMarker) locMapMarker.remove();
    locMapMarker = L.marker([lat, lng]).addTo(locMap);
  });
}

function syncLocMapMarker() {
  const lat = parseFloat(document.getElementById("locLat").value);
  const lng = parseFloat(document.getElementById("locLng").value);
  if (!locMap || isNaN(lat) || isNaN(lng)) return;
  if (locMapMarker) locMapMarker.remove();
  locMapMarker = L.marker([lat, lng]).addTo(locMap);
  locMap.setView([lat, lng], 16);
}

// ============================================================
// タブ切り替え
// ============================================================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
    if (btn.dataset.tab === "settings") {
      // 設定タブが表示されてから地図を初期化（非表示だと寸法が取れないため）
      setTimeout(initLocMap, 50);
    }
  });
});

// ============================================================
// 設定読み込み
// ============================================================
async function loadSettings() {
  try {
    const [locSnap, actSnap, staffSnap] = await Promise.all([
      getDoc(doc(db, "settings", "locations")),
      getDoc(doc(db, "settings", "activityTypes")),
      getDoc(doc(db, "settings", "cityStaff")),
    ]);
    locationsList = locSnap.exists() ? (locSnap.data().list || []) : [];
    activityTypesList = actSnap.exists() ? (actSnap.data().list || []) : [];
    cityStaffList = staffSnap.exists() ? (staffSnap.data().list || []) : [];
  } catch {
    locationsList = [];
    activityTypesList = [];
    cityStaffList = [];
  }

  renderLocationList();
  renderActivityTypeList();
  renderLocationDropdown();
  renderActivityTypeDropdown();
  renderCityStaffList();
  renderCityStaffDropdown();
  loadEquipment();
}


// ============================================================
// 場所設定
// ============================================================
async function saveLocations() {
  await setDoc(doc(db, "settings", "locations"), { list: locationsList });
}

let editingLocIndex = -1; // -1 = 新規追加モード、>=0 = 編集モード

function setLocFormMode(index) {
  const submitBtn = document.querySelector("#locationForm button[type='submit']");
  const cancelBtn = document.getElementById("locCancelEdit");
  const resultEl = document.getElementById("locGeocodeResult");

  if (index === -1) {
    // 新規追加モード
    editingLocIndex = -1;
    document.getElementById("locName").value = "";
    document.getElementById("locLat").value = "";
    document.getElementById("locLng").value = "";
    resultEl.textContent = "";
    submitBtn.textContent = "リストに追加";
    cancelBtn.classList.add("hidden");
    // リストの強調を解除
    document.querySelectorAll("#locationList .settings-item").forEach(r => r.classList.remove("editing"));
  } else {
    // 編集モード：既存データをフォームにセット
    editingLocIndex = index;
    const loc = locationsList[index];
    document.getElementById("locName").value = loc.name;
    document.getElementById("locLat").value = loc.lat || "";
    document.getElementById("locLng").value = loc.lng || "";
    resultEl.textContent = `✏️ 「${loc.name}」を編集中`;
    resultEl.style.color = "var(--blue)";
    submitBtn.textContent = "変更を保存";
    cancelBtn.classList.remove("hidden");
    // 対象行をハイライト
    document.querySelectorAll("#locationList .settings-item").forEach((r, i) => {
      r.classList.toggle("editing", i === index);
    });
    // 既存の座標を地図に反映
    syncLocMapMarker();
    // フォームまでスクロール
    document.getElementById("locName").focus();
    document.getElementById("locationForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function renderLocationList() {
  const container = document.getElementById("locationList");
  if (!container) return;
  container.innerHTML = "";
  if (locationsList.length === 0) {
    container.innerHTML = '<p class="help-text">まだ登録されていません</p>';
    return;
  }
  locationsList.forEach((loc, i) => {
    const row = document.createElement("div");
    row.className = "settings-item";

    const coordStr = loc.lat ? ` (${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)})` : "";
    const span = document.createElement("span");
    span.textContent = loc.name + coordStr;
    row.appendChild(span);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-sm";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", () => setLocFormMode(i));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn danger btn-sm";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`「${loc.name}」を削除しますか？`)) return;
      locationsList.splice(i, 1);
      if (editingLocIndex === i) setLocFormMode(-1);
      await saveLocations();
      renderLocationList();
      renderLocationDropdown();
    });

    row.appendChild(editBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

document.getElementById("locCancelEdit").addEventListener("click", () => setLocFormMode(-1));

function renderLocationDropdown() {
  editLocationSelect.innerHTML = '<option value="">--- プリセットから選択 ---</option>';
  locationsList.forEach((loc, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = loc.name;
    editLocationSelect.appendChild(opt);
  });
}


document.getElementById("locationForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("locName").value.trim();
  let lat = parseFloat(document.getElementById("locLat").value) || null;
  let lng = parseFloat(document.getElementById("locLng").value) || null;
  const resultEl = document.getElementById("locGeocodeResult");
  if (!name) return;
  try {
    if (editingLocIndex >= 0) {
      // 編集モード：既存データを上書き
      locationsList[editingLocIndex] = { name, lat, lng };
      await saveLocations();
      setLocFormMode(-1);
    } else {
      // 新規追加モード
      locationsList.push({ name, lat, lng });
      await saveLocations();
      resultEl.textContent = "";
      e.target.reset();
    }
    renderLocationList();
    renderLocationDropdown();
  } catch (err) {
    if (editingLocIndex < 0) locationsList.pop();
    resultEl.textContent = "❌ 保存失敗: Firestoreのセキュリティルールを確認してください。";
    resultEl.style.color = "red";
  }
});

// 活動状況: 現場でも迷わないよう大きなボタンで選択する
let currentStatus = "予定";

function setStatus(status) {
  currentStatus = status;
  statusBtnGroup.querySelectorAll(".status-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.status === status);
  });
  if (status === "延期") {
    rescheduleField.classList.remove("hidden");
    if (!editRescheduleDate.value && currentDateStr) {
      const next = new Date(currentDateStr + "T00:00:00");
      next.setDate(next.getDate() + 1);
      editRescheduleDate.value = formatDate(next);
    }
  } else {
    rescheduleField.classList.add("hidden");
  }
}

statusBtnGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".status-btn");
  if (btn) setStatus(btn.dataset.status);
});

editLocationSelect.addEventListener("change", (e) => {
  const idx = e.target.value;
  if (idx === "") return;
  const loc = locationsList[parseInt(idx)];
  editLocationName.value = loc.name;
  if (loc.lat && loc.lng) {
    currentLocation = { lat: loc.lat, lng: loc.lng };
    if (adminMap) {
      adminMap.setView([loc.lat, loc.lng], 16);
      if (adminMarker) adminMarker.remove();
      adminMarker = L.marker([loc.lat, loc.lng]).addTo(adminMap);
    }
  }
});

// ============================================================
// 活動内容設定
// ============================================================
async function saveActivityTypes() {
  await setDoc(doc(db, "settings", "activityTypes"), { list: activityTypesList });
}

function renderActivityTypeList() {
  const container = document.getElementById("activityTypeList");
  if (!container) return;
  container.innerHTML = "";
  if (activityTypesList.length === 0) {
    container.innerHTML = '<p class="help-text">まだ登録されていません</p>';
    return;
  }
  activityTypesList.forEach((type, i) => {
    const row = document.createElement("div");
    row.className = "settings-item";

    const viewSpan = document.createElement("span");
    viewSpan.className = "act-view";
    viewSpan.textContent = type;

    const editInput = document.createElement("input");
    editInput.type = "text";
    editInput.className = "act-edit";
    editInput.value = type;
    editInput.style.display = "none";
    editInput.style.flex = "1";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-sm";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", async () => {
      if (editInput.style.display === "none") {
        viewSpan.style.display = "none";
        editInput.style.display = "";
        editInput.focus();
        editBtn.textContent = "保存";
        delBtn.textContent = "キャンセル";
      } else {
        const newVal = editInput.value.trim();
        if (!newVal) return;
        activityTypesList[i] = newVal;
        try {
          await saveActivityTypes();
          renderActivityTypeList();
          renderActivityTypeDropdown();
        } catch { alert("保存に失敗しました"); }
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn danger btn-sm";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", async () => {
      if (editInput.style.display !== "none") {
        viewSpan.style.display = "";
        editInput.style.display = "none";
        editBtn.textContent = "編集";
        delBtn.textContent = "削除";
        return;
      }
      activityTypesList.splice(i, 1);
      await saveActivityTypes();
      renderActivityTypeList();
      renderActivityTypeDropdown();
    });

    row.appendChild(viewSpan);
    row.appendChild(editInput);
    row.appendChild(editBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function renderActivityTypeDropdown() {
  editActivityTypeSelect.innerHTML = '<option value="">--- プリセットから選択 ---</option>';
  activityTypesList.forEach((type, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = type;
    editActivityTypeSelect.appendChild(opt);
  });
}

document.getElementById("activityTypeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("actTypeName").value.trim();
  if (!name) return;
  activityTypesList.push(name);
  try {
    await saveActivityTypes();
    renderActivityTypeList();
    renderActivityTypeDropdown();
    e.target.reset();
  } catch (err) {
    activityTypesList.pop();
    alert("❌ 保存失敗: Firestoreのセキュリティルールに settings コレクションの許可が必要です。Firebase Console → Firestore → ルール を確認してください。");
  }
});

editActivityTypeSelect.addEventListener("change", (e) => {
  const idx = e.target.value;
  if (idx === "") return;
  editContentInput.value = activityTypesList[parseInt(idx)];
  editActivityTypeSelect.value = "";
});

function renderEditContentList() {
  const ul = document.getElementById("editContentList");
  ul.innerHTML = "";
  if (editContentItems.length === 0) {
    ul.innerHTML = '<li class="help-text" style="list-style:none; padding:4px 0;">（未設定）</li>';
    return;
  }
  editContentItems.forEach((item, i) => {
    const li = document.createElement("li");
    li.style.cssText = "display:flex; align-items:center; gap:6px; padding:3px 0;";
    const span = document.createElement("span");
    span.style.flex = "1";
    span.textContent = item;
    li.appendChild(span);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn danger btn-sm";
    btn.textContent = "削除";
    btn.addEventListener("click", () => {
      editContentItems.splice(i, 1);
      renderEditContentList();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

document.getElementById("addContentBtn").addEventListener("click", () => {
  const val = editContentInput.value.trim();
  if (!val) return;
  editContentItems.push(val);
  editContentInput.value = "";
  renderEditContentList();
});

// ============================================================
// 機材・備品
// ============================================================
async function loadEquipment() {
  try {
    const snap = await getDoc(doc(db, "settings", "equipment"));
    if (!snap.exists()) return;
    const d = snap.data();
    document.getElementById("eq-drinks").value = d.drinks || "";
    document.getElementById("eq-candy").value = d.candy || "";
    document.getElementById("eq-kari-count").value = d.kariCount ?? "";
    document.getElementById("eq-kari-status").value = d.kariStatus || "";
    document.getElementById("eq-kouki-status").value = d.koukiStatus || "";
    document.getElementById("eq-hammer-status").value = d.hammerStatus || "";
    document.getElementById("eq-chipper-status").value = d.chipperStatus || "";
  } catch {}
}

document.getElementById("equipmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await setDoc(doc(db, "settings", "equipment"), {
    drinks: document.getElementById("eq-drinks").value,
    candy: document.getElementById("eq-candy").value,
    kariCount: parseInt(document.getElementById("eq-kari-count").value) || 0,
    kariStatus: document.getElementById("eq-kari-status").value,
    koukiStatus: document.getElementById("eq-kouki-status").value,
    hammerStatus: document.getElementById("eq-hammer-status").value,
    chipperStatus: document.getElementById("eq-chipper-status").value,
  });
  const res = document.getElementById("eq-result");
  res.textContent = "✅ 保存しました。";
  setTimeout(() => (res.textContent = ""), 3000);
});

// ============================================================
// 市側参加者設定
// ============================================================
async function saveCityStaff() {
  await setDoc(doc(db, "settings", "cityStaff"), { list: cityStaffList });
}

function renderCityStaffList() {
  const container = document.getElementById("cityStaffList");
  if (!container) return;
  container.innerHTML = "";
  if (cityStaffList.length === 0) {
    container.innerHTML = '<p class="help-text">まだ登録されていません</p>';
    return;
  }
  cityStaffList.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "settings-item";
    const span = document.createElement("span");
    span.textContent = name;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn danger btn-sm";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", async () => {
      cityStaffList.splice(i, 1);
      await saveCityStaff();
      renderCityStaffList();
      renderCityStaffDropdown();
    });
    row.appendChild(span);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function renderCityStaffDropdown() {
  const sel = document.getElementById("editCityStaffSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">--- リストから選択 ---</option>';
  cityStaffList.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
}

document.getElementById("cityStaffForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("cityStaffName").value.trim();
  if (!name) return;
  cityStaffList.push(name);
  try {
    await saveCityStaff();
    renderCityStaffList();
    renderCityStaffDropdown();
    e.target.reset();
  } catch {
    cityStaffList.pop();
    alert("保存に失敗しました");
  }
});

function renderEditCityParticipantList() {
  const ul = document.getElementById("editCityParticipantList");
  if (!ul) return;
  ul.innerHTML = "";
  if (editCityParticipants.length === 0) {
    ul.innerHTML = '<li class="help-text" style="list-style:none; padding:4px 0;">（未選択）</li>';
    return;
  }
  editCityParticipants.forEach((name, i) => {
    const li = document.createElement("li");
    li.style.cssText = "display:flex; align-items:center; gap:6px; padding:3px 0;";
    const span = document.createElement("span");
    span.style.flex = "1";
    span.textContent = name;
    li.appendChild(span);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn danger btn-sm";
    btn.textContent = "削除";
    btn.addEventListener("click", () => {
      editCityParticipants.splice(i, 1);
      renderEditCityParticipantList();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

document.getElementById("addCityStaffBtn").addEventListener("click", () => {
  const sel = document.getElementById("editCityStaffSelect");
  const val = sel.value;
  if (!val || editCityParticipants.includes(val)) return;
  editCityParticipants.push(val);
  sel.value = "";
  renderEditCityParticipantList();
});

// ============================================================
// カレンダー
// ============================================================
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

    if (activityDates.has(dateStr)) {
      cell.classList.add("activity");
      cell.addEventListener("click", () => openEdit(dateStr));
    }

    calendarGrid.appendChild(cell);
  }

  loadMonthMarks(year, month);
}

// 月送り連打時に古い読み込み結果を破棄するためのトークン
let loadToken = 0;

async function loadMonthMarks(year, month) {
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
      // 振替日として作成されたイベントもカレンダーに表示する
      cell.classList.add("activity");
      cell.style.borderColor = "var(--orange)";
      cell.style.background = "#fff8e1";
      const mark = document.createElement("span");
      mark.className = "cell-reschedule";
      mark.textContent = "🔄 振替活動日";
      cell.appendChild(mark);
      cell.addEventListener("click", () => openEdit(dateStr));
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

  if (data.participants) {
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

  const cp = Array.isArray(data.cityParticipants) ? data.cityParticipants : (data.cityParticipants ? [data.cityParticipants] : []);
  if (cp.length > 0) {
    const cpEl = document.createElement("div");
    cpEl.className = "cell-participants";
    cpEl.textContent = "🏛️ " + cp.join("・");
    cell.appendChild(cpEl);
  }

  if (status === "延期" && data.rescheduleDate) {
    const rEl = document.createElement("div");
    rEl.className = "cell-reschedule";
    const rd = new Date(data.rescheduleDate + "T00:00:00");
    rEl.textContent = `🔄 振替: ${rd.getMonth() + 1}/${rd.getDate()}`;
    cell.appendChild(rEl);
  }
}

prevBtn.addEventListener("click", () => {
  if (monthIndex > 0) { monthIndex--; renderCalendar(); }
});
nextBtn.addEventListener("click", () => {
  if (monthIndex < months.length - 1) { monthIndex++; renderCalendar(); }
});

// ============================================================
// 年度セットアップ（緑地などの設定は年度をまたいで共通なので、活動日だけ登録すればよい）
// ============================================================
const setupYearSelect = document.getElementById("setupYearSelect");
getAvailableFiscalYears().forEach((fy) => {
  const opt = document.createElement("option");
  opt.value = fy;
  opt.textContent = fiscalYearLabel(fy);
  setupYearSelect.appendChild(opt);
});
setupYearSelect.value = getFiscalYear();

setupBtn.addEventListener("click", async () => {
  setupResult.textContent = "登録中...";
  setupBtn.disabled = true;
  const fy = parseInt(setupYearSelect.value);
  try {
    // 既存分を1クエリで確認し、足りない日だけバッチで一括登録する
    const dates = getActivityDatesForFiscalYear(fy);
    const existing = await fetchActivityIdsInRange(db, dates[0], dates[dates.length - 1]);
    const missing = dates.filter((d) => !existing.has(d));
    if (missing.length > 0) {
      const batch = writeBatch(db);
      missing.forEach((dateStr) => {
        batch.set(doc(db, "activities", dateStr), {
          date: dateStr,
          status: "予定",
          location: { name: "", lat: null, lng: null },
          contentList: [],
          content: "",
          notes: "",
          parking: false,
          participants: 0,
          adminComment: "",
        });
      });
      await batch.commit();
    }
    setupResult.textContent = `完了: ${fiscalYearLabel(fy)}の活動日 ${missing.length}件を新規登録しました（対象 全${dates.length}件）。`;
    renderCalendar();
  } catch (err) {
    setupResult.textContent = "❌ 登録に失敗しました: " + err.message;
  } finally {
    setupBtn.disabled = false;
  }
});

// ============================================================
// 今日・次回の活動をすぐ入力（現場でのワンタップ入力用）
// ============================================================
document.getElementById("quickTodayBtn").addEventListener("click", () => {
  const todayStr = formatDate(new Date());
  const sorted = [...activityDates].sort();
  const target = activityDates.has(todayStr)
    ? todayStr
    : sorted.find((d) => d > todayStr);
  if (!target) {
    alert("今後の活動日が見つかりません。年度の一括登録を行ってください。");
    return;
  }
  // カレンダーの表示月も対象日に合わせる
  const [y, m] = target.split("-").map(Number);
  const idx = months.findIndex((mm) => mm.year === y && mm.month === m);
  if (idx !== -1 && idx !== monthIndex) {
    monthIndex = idx;
    renderCalendar();
  }
  openEdit(target);
});

// ============================================================
// 編集モーダル
// ============================================================
async function openEdit(dateStr) {
  currentDateStr = dateStr;
  saveResult.textContent = "";
  editLocationSelect.value = "";
  editActivityTypeSelect.value = "";

  const d = new Date(dateStr + "T00:00:00");
  const holidayName = getHolidayName(dateStr);
  editDate.textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DOW_JA[d.getDay()]}）` +
    (holidayName ? ` 🎌 ${holidayName}` : "");

  let data = {};
  let internalMemo = null;
  try {
    // 内部メモは非公開のinternalサブコレクションに保存されている（旧データはactivities本体）
    const [snap, memoSnap] = await Promise.all([
      getDoc(doc(db, "activities", dateStr)),
      getDoc(doc(db, "activities", dateStr, "internal", "memo")).catch(() => null),
    ]);
    data = snap.exists() ? snap.data() : {};
    internalMemo = memoSnap && memoSnap.exists() ? memoSnap.data() : null;
  } catch (err) {
    alert("データの読み込みに失敗しました。通信環境をご確認ください。\n" + err.message);
    return;
  }

  editLocationName.value = data.location?.name || "";
  // 活動内容：配列(contentList)優先、旧string(content)は配列に変換
  if (Array.isArray(data.contentList) && data.contentList.length > 0) {
    editContentItems = [...data.contentList];
  } else if (data.content) {
    editContentItems = [data.content];
  } else {
    editContentItems = [];
  }
  renderEditContentList();
  editNotes.value = data.notes || "";
  editParking.checked = data.parking || false;
  editParticipants.value = data.participants || "";
  editAdminComment.value = internalMemo?.adminComment ?? data.adminComment ?? "";
  editCityParticipants = Array.isArray(data.cityParticipants) ? [...data.cityParticipants]
    : data.cityParticipants ? [data.cityParticipants] : [];
  renderEditCityParticipantList();
  editRescheduleDate.value = data.rescheduleDate || "";
  setStatus(data.status || "予定");

  currentLocation = data.location?.lat
    ? { lat: data.location.lat, lng: data.location.lng }
    : null;

  editModal.classList.remove("hidden");
  setTimeout(() => initAdminMap(currentLocation), 100);
}


function initAdminMap(location) {
  const center = location ? [location.lat, location.lng] : [35.7768, 139.5703];
  if (!adminMap) {
    adminMap = L.map("admin-map").setView(center, location ? 16 : 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(adminMap);
    adminMap.on("click", (e) => {
      currentLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (adminMarker) adminMarker.remove();
      adminMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(adminMap);
    });
  } else {
    adminMap.setView(center, location ? 16 : 13);
  }

  if (adminMarker) { adminMarker.remove(); adminMarker = null; }
  if (location) {
    adminMarker = L.marker(center).addTo(adminMap);
  }
  setTimeout(() => adminMap.invalidateSize(), 100);
}


closeEditBtn.addEventListener("click", () => editModal.classList.add("hidden"));
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) editModal.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") editModal.classList.add("hidden");
});

// 保存・削除の結果をモーダルが閉じた後でも伝えるトースト
function showToast(msg) {
  let t = document.getElementById("adminToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "adminToast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove("show"), 3000);
}

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveResult.textContent = "保存中...";

  // 内部メモは公開ドキュメントから読めない internal サブコレクションへ保存する。
  // （activities本体は誰でも読めるため。ルール未公開の間は旧方式へフォールバック）
  const memoText = editAdminComment.value.trim();
  let memoPrivate = true;
  try {
    await setDoc(doc(db, "activities", currentDateStr, "internal", "memo"), {
      adminComment: memoText,
    });
  } catch {
    memoPrivate = false;
  }

  try {
    await setDoc(
      doc(db, "activities", currentDateStr),
      {
        date: currentDateStr,
        status: currentStatus,
        location: {
          name: editLocationName.value.trim(),
          lat: currentLocation?.lat ?? null,
          lng: currentLocation?.lng ?? null,
        },
        contentList: editContentItems,
        content: editContentItems.join("・"),
        notes: editNotes.value.trim(),
        parking: editParking.checked,
        participants: parseInt(editParticipants.value) || 0,
        // internalへ保存できたら公開側の旧データは消す（移行）。できない間は旧方式で保存
        adminComment: memoPrivate ? deleteField() : memoText,
        cityParticipants: editCityParticipants,
        rescheduleDate: currentStatus === "延期" ? (editRescheduleDate.value || null) : null,
      },
      { merge: true }
    );

    // 延期の場合、振替日のイベントを自動作成（まだ存在しない場合）
    const rDate = currentStatus === "延期" ? editRescheduleDate.value : null;
    if (rDate) {
      const rRef = doc(db, "activities", rDate);
      const rSnap = await getDoc(rRef);
      if (!rSnap.exists()) {
        await setDoc(rRef, {
          date: rDate,
          status: "予定",
          location: { name: "", lat: null, lng: null },
          contentList: [],
          content: "",
          notes: "",
          parking: false,
          participants: 0,
          adminComment: `${currentDateStr} からの振替`,
          cityParticipants: [],
          rescheduleDate: null,
          isReschedule: true,
        });
      }
    }
  } catch (err) {
    saveResult.textContent = "❌ 保存に失敗しました: " + err.message;
    return;
  }

  editModal.classList.add("hidden");
  renderCalendar();
  showToast(memoPrivate || !memoText
    ? `✅ ${currentDateStr} を保存しました`
    : `✅ 保存しました（⚠️ 内部メモの非公開化にはFirestoreルールの公開が必要です）`);
});

deleteEventBtn.addEventListener("click", async () => {
  if (!confirm(`${currentDateStr} のデータを削除しますか？\n（カレンダーの日付は残りますがデータが初期化されます）`)) return;
  try {
    await deleteDoc(doc(db, "activities", currentDateStr));
    // 内部メモも一緒に削除（ルール未公開などで失敗しても本体削除は成立させる）
    await deleteDoc(doc(db, "activities", currentDateStr, "internal", "memo")).catch(() => {});
  } catch (err) {
    saveResult.textContent = "❌ 削除に失敗しました: " + err.message;
    return;
  }
  editModal.classList.add("hidden");
  renderCalendar();
  showToast(`🗑️ ${currentDateStr} のデータを削除しました`);
});
