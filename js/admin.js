import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  inMemoryPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
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
const auth = getAuth(app);
const db = getFirestore(app);

// 管理ページを開くたびに毎回ログインが必要（セッションを保持しない）
setPersistence(auth, inMemoryPersistence);

const activityDates = new Set(getFiscalYearActivityDates());
const months = getFiscalYearMonths();
const today = new Date();
let monthIndex = months.findIndex(
  (m) => m.year === today.getFullYear() && m.month === today.getMonth() + 1
);
if (monthIndex === -1) monthIndex = 0;

// 設定キャッシュ
let locationsList = [];    // [{id, name, lat, lng}]
let activityTypesList = []; // [string]

// 編集状態
let currentDateStr = null;
let currentLocation = null;
let editContentItems = []; // 活動内容リスト（複数）
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
const editStatus = document.getElementById("editStatus");
const editLocationSelect = document.getElementById("editLocationSelect");
const editLocationName = document.getElementById("editLocationName");
const editActivityTypeSelect = document.getElementById("editActivityTypeSelect");
const editContentInput = document.getElementById("editContentInput");
const editNotes = document.getElementById("editNotes");
const editParking = document.getElementById("editParking");
const editParticipants = document.getElementById("editParticipants");
const editAdminComment = document.getElementById("editAdminComment");
const editCityParticipants = document.getElementById("editCityParticipants");
const editRescheduleDate = document.getElementById("editRescheduleDate");
const rescheduleField = document.getElementById("rescheduleField");
const editLatLng = document.getElementById("editLatLng");
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
      document.getElementById("loginEmail").value,
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
    const [locSnap, actSnap] = await Promise.all([
      getDoc(doc(db, "settings", "locations")),
      getDoc(doc(db, "settings", "activityTypes")),
    ]);
    locationsList = locSnap.exists() ? (locSnap.data().list || []) : [];
    activityTypesList = actSnap.exists() ? (actSnap.data().list || []) : [];
  } catch {
    // Firestoreルール未設定時でもカレンダーは動作する
    locationsList = [];
    activityTypesList = [];
  }

  renderLocationList();
  renderActivityTypeList();
  renderLocationDropdown();
  renderActivityTypeDropdown();
  loadEquipment();
}

// ============================================================
// ジオコーディング（4段階フォールバック）
// 1) Overpass API（OSM施設名直接検索・新座市内限定）
// 2) 国土地理院 住所検索API
// 3) Nominatim bounded（新座市バウンディングボックス内）
// 4) Nominatim 通常検索（新座市付き）
// ============================================================
async function geocodeLocation(name) {
  // 新座市バウンディングボックス
  const BBOX_OVERPASS = "35.742,139.502,35.835,139.620"; // S,W,N,E
  const BBOX_NOM = "139.502,35.835,139.620,35.742";      // W,N,E,S (Nominatim viewbox)
  const withCity = name.includes("新座") ? name : "新座市 " + name;

  // 1. Overpass API：OSMから施設名で直接検索（公園・緑地・建物など）
  try {
    const q = `[out:json][timeout:15];(`
      + `node["name"="${name}"](${BBOX_OVERPASS});`
      + `way["name"="${name}"](${BBOX_OVERPASS});`
      + `relation["name"="${name}"](${BBOX_OVERPASS});`
      + `);out center 1;`;
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`
    );
    const data = await res.json();
    if (data.elements?.length > 0) {
      const el = data.elements[0];
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat && lng) return { lat, lng, found: el.tags?.name || name };
    }
  } catch {}

  // 2. 国土地理院 住所検索API（日本の住所・地名に強い）
  try {
    const res = await fetch(
      `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(withCity)}`
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const [lng, lat] = data[0].geometry.coordinates;
      return { lat, lng, found: data[0].properties.title };
    }
  } catch {}

  // 3. Nominatim：施設名のみで新座市エリア内を検索（bounded）
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}`
      + `&format=json&limit=3&countrycodes=jp&viewbox=${BBOX_NOM}&bounded=1`,
      { headers: { "Accept-Language": "ja,en" } }
    );
    const data = await res.json();
    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        found: data[0].display_name.split(",").slice(0, 3).join(", "),
      };
    }
  } catch {}

  // 4. Nominatim：「新座市 ＋ 施設名」で全国検索
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(withCity)}`
      + `&format=json&limit=3&countrycodes=jp`,
      { headers: { "Accept-Language": "ja,en" } }
    );
    const data = await res.json();
    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        found: data[0].display_name.split(",").slice(0, 3).join(", "),
      };
    }
  } catch {}

  return null;
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

document.getElementById("locGeocode").addEventListener("click", async () => {
  const name = document.getElementById("locName").value.trim();
  if (!name) { alert("場所名を入力してください"); return; }
  const btn = document.getElementById("locGeocode");
  const resultEl = document.getElementById("locGeocodeResult");
  btn.textContent = "検索中...";
  btn.disabled = true;
  const coords = await geocodeLocation(name);
  btn.textContent = "📍 座標を自動取得";
  btn.disabled = false;
  if (coords) {
    document.getElementById("locLat").value = coords.lat.toFixed(6);
    document.getElementById("locLng").value = coords.lng.toFixed(6);
    resultEl.textContent = `✅ 取得: 「${coords.found}」(${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}) ※地図クリックで微調整可能`;
    resultEl.style.color = "green";
    syncLocMapMarker();
  } else {
    resultEl.textContent = "❌ 自動取得できませんでした。下の地図をクリックして場所を指定してください。";
    resultEl.style.color = "red";
  }
});

document.getElementById("locationForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("locName").value.trim();
  let lat = parseFloat(document.getElementById("locLat").value) || null;
  let lng = parseFloat(document.getElementById("locLng").value) || null;
  const resultEl = document.getElementById("locGeocodeResult");
  if (!name) return;
  if (!lat || !lng) {
    const coords = await geocodeLocation(name);
    if (coords) { lat = coords.lat; lng = coords.lng; }
  }
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

editStatus.addEventListener("change", () => {
  if (editStatus.value === "延期") {
    rescheduleField.classList.remove("hidden");
    if (!editRescheduleDate.value && currentDateStr) {
      const next = new Date(currentDateStr + "T00:00:00");
      next.setDate(next.getDate() + 1);
      editRescheduleDate.value = formatDate(next);
    }
  } else {
    rescheduleField.classList.add("hidden");
  }
});

editLocationSelect.addEventListener("change", (e) => {
  const idx = e.target.value;
  if (idx === "") return;
  const loc = locationsList[parseInt(idx)];
  editLocationName.value = loc.name;
  if (loc.lat && loc.lng) {
    currentLocation = { lat: loc.lat, lng: loc.lng };
    updateLatLngLabel();
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
    li.innerHTML = `<span style="flex:1;">${item}</span>`;
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

  loadStatusMarks(year, month);
  loadRescheduleMarks(year, month);
}

async function loadStatusMarks(year, month) {
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

    if (data.cityParticipants) {
      const cpEl = document.createElement("div");
      cpEl.className = "cell-participants";
      cpEl.textContent = "🏛️ " + data.cityParticipants;
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
}

// 振替日として作成されたイベントもカレンダーに表示する
async function loadRescheduleMarks(year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  for (const cell of calendarGrid.querySelectorAll(".day-cell:not(.activity)")) {
    const dateStr = cell.dataset.date;
    if (!dateStr || !dateStr.startsWith(prefix)) continue;
    const snap = await getDoc(doc(db, "activities", dateStr));
    if (!snap.exists() || !snap.data().isReschedule) continue;
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

prevBtn.addEventListener("click", () => {
  if (monthIndex > 0) { monthIndex--; renderCalendar(); }
});
nextBtn.addEventListener("click", () => {
  if (monthIndex < months.length - 1) { monthIndex++; renderCalendar(); }
});

// ============================================================
// 初回セットアップ
// ============================================================
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
        contentList: [],
        content: "",
        notes: "",
        parking: false,
        participants: 0,
        adminComment: "",
      });
      created++;
    }
  }
  setupResult.textContent = `完了: ${created}件の活動日を新規登録しました（対象 全${activityDates.size}件）。`;
  renderCalendar();
});

// ============================================================
// 編集モーダル
// ============================================================
async function openEdit(dateStr) {
  currentDateStr = dateStr;
  saveResult.textContent = "";
  editLocationSelect.value = "";
  editActivityTypeSelect.value = "";

  const d = new Date(dateStr);
  const holidayName = getHolidayName(dateStr);
  editDate.textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DOW_JA[d.getDay()]}）` +
    (holidayName ? ` 🎌 ${holidayName}` : "");

  const snap = await getDoc(doc(db, "activities", dateStr));
  const data = snap.exists() ? snap.data() : {};

  editStatus.value = data.status || "予定";
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
  editAdminComment.value = data.adminComment || "";
  editCityParticipants.value = data.cityParticipants || "";
  editRescheduleDate.value = data.rescheduleDate || "";
  if (data.status === "延期") {
    rescheduleField.classList.remove("hidden");
    if (!editRescheduleDate.value) {
      const next = new Date(dateStr + "T00:00:00");
      next.setDate(next.getDate() + 1);
      editRescheduleDate.value = formatDate(next);
    }
  } else {
    rescheduleField.classList.add("hidden");
  }

  currentLocation = data.location?.lat
    ? { lat: data.location.lat, lng: data.location.lng }
    : null;
  updateLatLngLabel();

  editModal.classList.remove("hidden");
  setTimeout(() => initAdminMap(currentLocation), 100);
}

function updateLatLngLabel() {
  editLatLng.textContent = currentLocation
    ? `緯度・経度: ${Number(currentLocation.lat).toFixed(6)}, ${Number(currentLocation.lng).toFixed(6)}`
    : "緯度・経度: 未設定（地図をクリックしてください）";
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
      updateLatLngLabel();
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

// 編集モーダル内の「地図で確認」ボタン
document.getElementById("geocodeBtn").addEventListener("click", async () => {
  const name = editLocationName.value.trim();
  if (!name) { alert("場所名を入力してください"); return; }
  const btn = document.getElementById("geocodeBtn");
  btn.textContent = "検索中...";
  btn.disabled = true;
  const coords = await geocodeLocation(name);
  btn.textContent = "🔍 地図で確認";
  btn.disabled = false;
  if (coords) {
    currentLocation = { lat: coords.lat, lng: coords.lng };
    updateLatLngLabel();
    if (adminMap) {
      adminMap.setView([coords.lat, coords.lng], 17);
      if (adminMarker) adminMarker.remove();
      adminMarker = L.marker([coords.lat, coords.lng]).addTo(adminMap);
    }
    saveResult.textContent = `📍 「${coords.found}」を地図に表示。違う場合は地図をクリックして修正できます。`;
  } else {
    alert("場所が見つかりませんでした。\n\nヒント:\n・施設名より住所で検索（例: 新座市栄3丁目）\n・「新座市〇〇公園」のように市名を付けて検索\n・見つからない場合は地図を直接クリックして場所を指定してください");
  }
});

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
      contentList: editContentItems,
      content: editContentItems.join("・"),
      notes: editNotes.value.trim(),
      parking: editParking.checked,
      participants: parseInt(editParticipants.value) || 0,
      adminComment: editAdminComment.value.trim(),
      cityParticipants: editCityParticipants.value.trim(),
      rescheduleDate: editStatus.value === "延期" ? (editRescheduleDate.value || null) : null,
    },
    { merge: true }
  );

  // 延期の場合、振替日のイベントを自動作成（まだ存在しない場合）
  const rDate = editStatus.value === "延期" ? editRescheduleDate.value : null;
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
        cityParticipants: "",
        rescheduleDate: null,
        isReschedule: true,
      });
    }
  }

  editModal.classList.add("hidden");
  renderCalendar();
});

deleteEventBtn.addEventListener("click", async () => {
  if (!confirm(`${currentDateStr} のデータを削除しますか？\n（カレンダーの日付は残りますがデータが初期化されます）`)) return;
  await deleteDoc(doc(db, "activities", currentDateStr));
  editModal.classList.add("hidden");
  renderCalendar();
});
