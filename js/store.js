// Firestore共通ユーティリティ
// カレンダー表示用に、日ごとのgetDoc連打ではなく月単位の1クエリでまとめて取得する
// （表示の高速化とFirestore読み取り回数の削減のため）
import {
  collection,
  query,
  where,
  getDocs,
  documentId,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 指定月(month: 1-12)の activities ドキュメントを Map<dateStr, data> で返す
export async function fetchMonthActivities(db, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const q = query(
    collection(db, "activities"),
    where(documentId(), ">=", `${prefix}-01`),
    where(documentId(), "<=", `${prefix}-31`)
  );
  const snap = await getDocs(q);
  const map = new Map();
  snap.forEach((d) => map.set(d.id, d.data()));
  return map;
}

// 期間内(両端含む)に存在する activities ドキュメントIDの集合を返す（初回セットアップ用）
export async function fetchActivityIdsInRange(db, startDate, endDate) {
  const q = query(
    collection(db, "activities"),
    where(documentId(), ">=", startDate),
    where(documentId(), "<=", endDate)
  );
  const snap = await getDocs(q);
  return new Set(snap.docs.map((d) => d.id));
}
