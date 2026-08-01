// Firestore の家計簿データを JSON ファイルに書き出す(月末の自動バックアップ用)。
//
// 依存パッケージなし。Firestore の REST API を fetch で叩くだけ。
// 出力はアプリの「バックアップから復元」がそのまま読める形式
//   { settings, expenses, householdId, backedUpAt }
//
// 使い方:
//   node scripts/backup.mjs --household <世帯ID> [--dest <保存先フォルダ>]
//   環境変数 COUPLE_BUDGET_HOUSEHOLD / COUPLE_BUDGET_DEST でも指定できる。
//
// 世帯IDは家計簿を開くための鍵そのものなので、公開リポジトリには絶対に書かないこと。
// (タスクスケジューラの引数として渡している)
import { writeFile, rename, readFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { firebaseConfig } from '../public/js/firebase-config.js';

// R: が割り当てられていない状況(タスク実行時など)に備えて UNC も試す
const DEST_CANDIDATES = ['R:\\良太\\家計簿', '\\\\LS210DEAB\\share\\良太\\家計簿'];
const LOG_FILE = path.join(os.homedir(), 'AppData', 'Local', 'couple-budget', 'backup.log');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// タスクスケジューラから起動されると標準出力が無いため、console.log 自体が失敗しうる。
// ログを落としても本処理は続け、書ける場所すべてに残す。
let destLogFile = null;

async function log(line) {
  const text = `[${new Date().toLocaleString('ja-JP')}] ${line}`;
  try { console.log(text); } catch { /* 出力先が無い場合 */ }
  for (const target of [LOG_FILE, destLogFile]) {
    if (!target) continue;
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await appendFile(target, text + '\r\n', 'utf8');
    } catch { /* 片方が書けなくても続行 */ }
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url.split('?')[0]} が失敗 (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// Firestore REST の型付き値 → 素の JavaScript の値(テストのため export している)
export function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return null;
}
export const fromFields = (fields) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));

export async function fetchBudget(householdId) {
  const { apiKey, projectId } = firebaseConfig;
  const { idToken } = await api(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const auth = { headers: { authorization: `Bearer ${idToken}` } };

  const doc = await api(`${base}/households/${householdId}`, auth);
  const settings = fromFields(doc.fields ?? {});

  const expenses = [];
  let pageToken = '';
  do {
    const page = await api(
      `${base}/households/${householdId}/expenses?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`,
      auth);
    for (const d of page.documents ?? []) {
      expenses.push({ id: d.name.split('/').pop(), ...fromFields(d.fields ?? {}) });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  expenses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { settings, expenses };
}

function resolveDest() {
  const given = arg('dest') ?? process.env.COUPLE_BUDGET_DEST;
  if (given) {
    if (!existsSync(given)) throw new Error(`指定された保存先が見つかりません: ${given}`);
    return given;
  }
  const found = DEST_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`保存先が見つかりません(${DEST_CANDIDATES.join(' / ')})。NASに接続できているか確認してください`);
  }
  return found;
}

async function main() {
  const householdId = arg('household') ?? process.env.COUPLE_BUDGET_HOUSEHOLD;
  if (!householdId) throw new Error('世帯IDが指定されていません(--household <ID>)');

  const dest = resolveDest();
  destLogFile = path.join(dest, 'バックアップ実行ログ.txt'); // 保存先でも結果を確認できるように
  const { settings, expenses } = await fetchBudget(householdId);
  if (!Array.isArray(settings.categories) || settings.categories.length === 0) {
    throw new Error('項目情報を取得できませんでした(世帯IDが違う可能性があります)');
  }

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const file = path.join(dest, `ふたり家計簿-${stamp}.json`);
  const body = JSON.stringify({
    householdId,
    backedUpAt: now.toISOString(),
    settings,
    expenses,
  }, null, 1);

  // 途中で切れた壊れたファイルを残さないよう、一時ファイルに書いてから置き換える
  const tmp = `${file}.tmp`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, file);

  // 書けたファイルを読み直して壊れていないか確認する
  const check = JSON.parse(await readFile(file, 'utf8'));
  if (check.expenses.length !== expenses.length) {
    throw new Error('書き出したファイルの件数が一致しません');
  }

  await log(`成功: ${file}(支出${expenses.length}件 / 項目${settings.categories.length}個)`);
}

// テストから import しただけでバックアップが走らないよう、直接実行のときだけ動かす
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    await log(`失敗: ${err.message}`);
    process.exit(1);
  });
}
