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
let adminMap = null;
let adminMarker = null;

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
const editContent = document.getElementById("editContent");
const editNotes = document.getElementById("editNotes");
const editParking = document.getElementById("editParking");
const editParticipants = document.getElementById("editParticipants");
const editAdminComment = document.getElementById("editAdminComment");
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
// タブ切り替え
// ============================================================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
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
// ジオコーディング
// 優先順: 1) 国土地理院API（日本住所に強い）→ 2) Nominatim（OSM）
// ============================================================
async function geocodeLocation(name) {
  const withCity = name.includes("新座") ? name : "新座市 " + name;

  // 1. 国土地理院 住所検索API（無料・日本特化）
  try {
    const gsiUrl = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(withCity)}`;
    const res = await fetch(gsiUrl);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const [lng, lat] = data[0].geometry.coordinates;
      return { lat, lng, found: data[0].properties.title };
    }
  } catch {}

  // 2. Nominatim / OpenStreetMap（新座市エリアを優先）
  try {
    // viewbox = 新座市の境界 (minLng,maxLat,maxLng,minLat)
    const nomUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(withCity)}` +
      `&format=json&limit=3&countrycodes=jp` +
      `&viewbox=139.502,35.835,139.620,35.742&bounded=0`;
    const res = await fetch(nomUrl, { headers: { "Accept-Language": "ja,en" } });
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
    row.dataset.index = i;

    const coordStr = loc.lat ? ` (${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)})` : "";
    const viewHtml = `<span class="loc-view">${loc.name}${coordStr}</span>`;
    const editHtml = `
      <div class="loc-edit" style="display:none; flex:1; gap:4px; flex-wrap:wrap; align-items:center;">
        <input type="text" class="loc-edit-name" value="${loc.name}" placeholder="場所名" style="flex:1; min-width:120px;">
        <input type="number" class="loc-edit-lat" value="${loc.lat || ''}" placeholder="緯度" step="any" style="width:100px;">
        <input type="number" class="loc-edit-lng" value="${loc.lng || ''}" placeholder="経度" step="any" style="width:100px;">
      </div>`;
    row.innerHTML = viewHtml + editHtml;

    // 編集ボタン
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-sm";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", () => {
      const isEditing = row.querySelector(".loc-edit").style.display !== "none";
      if (!isEditing) {
        row.querySelector(".loc-view").style.display = "none";
        row.querySelector(".loc-edit").style.display = "flex";
        editBtn.textContent = "保存";
        delBtn.textContent = "キャンセル";
      } else {
        const newName = row.querySelector(".loc-edit-name").value.trim();
        const newLat = parseFloat(row.querySelector(".loc-edit-lat").value) || null;
        const newLng = parseFloat(row.querySelector(".loc-edit-lng").value) || null;
        if (!newName) return;
        locationsList[i] = { name: newName, lat: newLat, lng: newLng };
        saveLocations().then(() => {
          renderLocationList();
          renderLocationDropdown();
        }).catch(() => alert("保存に失敗しました"));
      }
    });

    // 削除/キャンセルボタン
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn danger btn-sm";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", async () => {
      if (row.querySelector(".loc-edit").style.display !== "none") {
        // キャンセル
        row.querySelector(".loc-view").style.display = "";
        row.querySelector(".loc-edit").style.display = "none";
        editBtn.textContent = "編集";
        delBtn.textContent = "削除";
        return;
      }
      if (!confirm(`「${loc.name}」を削除しますか？`)) return;
      locationsList.splice(i, 1);
      await saveLocations();
      renderLocationList();
      renderLocationDropdown();
    });

    row.appendChild(editBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

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
  } else {
    resultEl.textContent = "❌ 見つかりませんでした。住所で検索するか（例: 新座市栄3丁目）、地図を直接クリックして場所を指定してください。";
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
  locationsList.push({ name, lat, lng });
  try {
    await saveLocations();
    renderLocationList();
    renderLocationDropdown();
    resultEl.textContent = "";
    e.target.reset();
  } catch (err) {
    locationsList.pop();
    resultEl.textContent = "❌ 保存失敗: Firestoreのセキュリティルールに settings コレクションの許可が必要です。Firebase Console → Firestore → ルール を確認してください。";
    resultEl.style.color = "red";
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
  editContent.value = activityTypesList[parseInt(idx)];
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
  editContent.value = data.content || "";
  editNotes.value = data.notes || "";
  editParking.checked = data.parking || false;
  editParticipants.value = data.participants || "";
  editAdminComment.value = data.adminComment || "";

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
      content: editContent.value.trim(),
      notes: editNotes.value.trim(),
      parking: editParking.checked,
      participants: parseInt(editParticipants.value) || 0,
      adminComment: editAdminComment.value.trim(),
    },
    { merge: true }
  );
  saveResult.textContent = "✅ 保存しました。";
  renderCalendar();
});

deleteEventBtn.addEventListener("click", async () => {
  if (!confirm(`${currentDateStr} のデータを削除しますか？\n（カレンダーの日付は残りますがデータが初期化されます）`)) return;
  await deleteDoc(doc(db, "activities", currentDateStr));
  editModal.classList.add("hidden");
  renderCalendar();
});
