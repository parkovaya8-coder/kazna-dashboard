/**
 * Google Apps Script — Web App для Казначейства
 *
 * ИНСТРУКЦИЯ ПО УСТАНОВКЕ:
 * 1. Откройте Google Sheets → Расширения → Apps Script
 * 2. Создайте новый файл "90_web_app.gs"
 * 3. Вставьте этот код
 * 4. Деплой → Новый деплой → Тип: Веб-приложение
 *    - Описание: "Dashboard API v1"
 *    - Выполнять как: Я
 *    - Доступ: Все (Anyone)
 * 5. Скопируйте URL деплоя и вставьте в дашборд (переменная WEBAPP_URL)
 *
 * URL будет вида: https://script.google.com/macros/s/AKfycb.../exec
 */

// ========== КОНФИГУРАЦИЯ ==========
const SHEET_NAMES = {
  receipts: 'Поступления',
  accruals: 'Начисления',
  deductions: 'Удержания',
  payouts: 'Выплаты',
  internals: 'Внутренние',
  conversions: 'Конвертации',
  ownerBalances: 'Баланс_Владельцы',
  contourBalances: 'Баланс_Контуры',
  courses: 'Спр_Курсы',
  contours: 'Спр_Контуры',
  owners: 'Спр_Владельцы'
};

// Строка, с которой начинаются данные (после заголовков + TOTAL)
const DATA_START_ROW = 5;
// Строка с техническими именами (en)
const TECH_ROW = 2;

// ========== ГЛАВНЫЙ ОБРАБОТЧИК ==========
function doGet(e) {
  try {
    const params = e?.parameter || {};
    const ownerId = params.owner || null; // ?owner=OWN-002
    const sheet = params.sheet || null;   // ?sheet=receipts (конкретный лист)
    const since = params.since || null;   // ?since=2026-03-01 (фильтр по дате)

    let result;

    if (sheet && SHEET_NAMES[sheet]) {
      // Запрос конкретного листа
      result = readSheet(SHEET_NAMES[sheet], ownerId, since);
    } else {
      // Полная выгрузка всех данных
      result = buildFullDashboardData(ownerId, since);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: true,
        message: error.message,
        stack: error.stack
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== ПОЛНАЯ ВЫГРУЗКА ==========
function buildFullDashboardData(ownerId, since) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Читаем все операционные листы
  const receipts = readSheetData(ss, SHEET_NAMES.receipts);
  const accruals = readSheetData(ss, SHEET_NAMES.accruals);
  const deductions = readSheetData(ss, SHEET_NAMES.deductions);
  const payouts = readSheetData(ss, SHEET_NAMES.payouts);
  const internals = readSheetData(ss, SHEET_NAMES.internals);
  const conversions = readSheetData(ss, SHEET_NAMES.conversions);

  // Справочники
  const ownerBalances = readSheetData(ss, SHEET_NAMES.ownerBalances);
  const contourBalances = readSheetData(ss, SHEET_NAMES.contourBalances);
  const courses = readSheetData(ss, SHEET_NAMES.courses);
  const contours = readSheetData(ss, SHEET_NAMES.contours);
  const owners = readSheetData(ss, SHEET_NAMES.owners);

  // Фильтрация по владельцу
  let filteredReceipts = receipts;
  let filteredAccruals = accruals;
  let filteredDeductions = deductions;
  let filteredPayouts = payouts;
  let filteredInternals = internals;
  let filteredConversions = conversions;

  if (ownerId) {
    filteredReceipts = receipts.filter(r => r.owner_id === ownerId);
    filteredAccruals = accruals.filter(a => a.owner_id === ownerId);

    // Для удержаний фильтруем по accrual_id связанных нарахувань
    const accrualIds = new Set(filteredAccruals.map(a => a.accrual_id));
    filteredDeductions = deductions.filter(d =>
      accrualIds.has(d.accrual_id) || d.owner_id === ownerId
    );

    filteredPayouts = payouts.filter(p => p.owner_id === ownerId);
    filteredInternals = internals.filter(i =>
      i.owner_id === ownerId || i.source_owner_id === ownerId || i.target_owner_id === ownerId
    );
    filteredConversions = conversions.filter(c => c.owner_id === ownerId);
  }

  // Фильтрация по дате
  if (since) {
    const sinceDate = new Date(since);
    filteredReceipts = filteredReceipts.filter(r => new Date(r.receipt_date) >= sinceDate);
    filteredAccruals = filteredAccruals.filter(a => new Date(a.accrual_date) >= sinceDate);
    filteredPayouts = filteredPayouts.filter(p => new Date(p.payout_date) >= sinceDate);
  }

  // Баланси владельцев
  let ownerData = ownerBalances;
  if (ownerId) {
    ownerData = ownerBalances.filter(o => o.owner_id === ownerId);
  }

  // Собираем агрегаты для каждого владельца
  const ownerAggregates = {};
  for (const ob of ownerData) {
    ownerAggregates[ob.owner_id] = {
      owner_id: ob.owner_id,
      owner_name: ob.owner_name || '',
      total_gross: toNum(ob.total_gross || ob.accrued_gross || 0),
      total_deductions: toNum(ob.total_deductions || 0),
      total_net: toNum(ob.total_net || ob.net_to_pay || 0),
      total_paid: toNum(ob.total_paid || 0),
      total_owner_expenses: toNum(ob.total_owner_expenses || ob.opex_total || 0),
      balance_due: toNum(ob.balance_due || ob.debt || 0)
    };
  }

  return {
    meta: {
      generated_at: new Date().toISOString(),
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      owner_filter: ownerId,
      since_filter: since
    },
    receipts: filteredReceipts.map(normalizeReceipt),
    accruals: filteredAccruals.map(normalizeAccrual),
    deductions: filteredDeductions.map(normalizeDeduction),
    payouts: filteredPayouts.map(normalizePayout),
    internals: filteredInternals.map(normalizeInternal),
    conversions: filteredConversions.map(normalizeConversion),
    owner_balances: ownerData.map(normalizeOwnerBalance),
    contour_balances: contourBalances.map(normalizeContourBalance),
    courses: courses.map(c => ({ course_id: c.course_id, course_name: c.course_name })),
    contours: contours.map(c => ({ contour_id: c.contour_id, contour_name: c.contour_name, contour_type: c.contour_type })),
    owners: owners.map(o => ({ owner_id: o.owner_id, owner_name: o.owner_name })),
    owner_aggregates: ownerAggregates
  };
}

// ========== ЧТЕНИЕ ЛИСТА ==========
function readSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < DATA_START_ROW || lastCol < 1) return [];

  // Читаем техимена из строки 2
  const techNames = sheet.getRange(TECH_ROW, 1, 1, lastCol).getValues()[0];

  // Читаем данные со строки 5
  const dataRows = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, lastCol).getValues();

  const result = [];
  for (const row of dataRows) {
    // Пропускаем пустые строки (нет ID в первой колонке)
    if (!row[0] || String(row[0]).trim() === '') continue;

    const obj = {};
    for (let i = 0; i < techNames.length; i++) {
      const key = String(techNames[i]).trim();
      if (!key) continue;

      let val = row[i];
      // Конвертируем даты в ISO строки
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[key] = val;
    }
    result.push(obj);
  }

  return result;
}

// Обёртка для запроса конкретного листа
function readSheet(sheetName, ownerId, since) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let data = readSheetData(ss, sheetName);

  if (ownerId) {
    data = data.filter(r => r.owner_id === ownerId);
  }

  return { data, count: data.length };
}

// ========== НОРМАЛИЗАЦИЯ ==========
function normalizeReceipt(r) {
  return {
    receipt_id: r.receipt_id || '',
    receipt_date: formatDate(r.receipt_date),
    source_system: r.source_system || 'manual',
    source_txn_id: r.source_txn_id || '',
    course_id: r.course_id || '',
    course_name: r.course_name || '',
    owner_id: r.owner_id || '',
    owner_name: r.owner_name || '',
    channel_id: r.channel_id || '',
    store_id: r.store_id || '',
    contour_id: r.contour_id || '',
    contour_name: r.contour_name || '',
    account_id: r.account_id || '',
    currency: r.currency || 'UAH',
    amount: toNum(r.amount),
    fx_rate_to_uah: toNum(r.fx_rate_to_uah || 1),
    amount_uah: toNum(r.amount_uah || r.amount),
    wfp_fee_amount: toNum(r.wfp_fee_amount || 0),
    fx_rate_source: r.fx_rate_source || '',
    status: r.status || 'confirmed',
    wfp_fee_on_seller: r.wfp_fee_on_seller || ''
  };
}

function normalizeAccrual(a) {
  return {
    accrual_id: a.accrual_id || '',
    receipt_id: a.receipt_id || '',
    owner_id: a.owner_id || '',
    course_id: a.course_id || '',
    course_name: a.course_name || '',
    contour_id: a.contour_id || '',
    contour_name: a.contour_name || '',
    accrual_date: formatDate(a.accrual_date),
    gross_amount: toNum(a.gross_amount),
    gross_currency: a.gross_currency || 'UAH',
    fx_rate_to_uah: toNum(a.fx_rate_to_uah || 1),
    wfp_fee: toNum(a.wfp_fee || 0),
    total_deductions: toNum(a.total_deductions || 0),
    net_amount: toNum(a.net_amount || 0),
    net_currency: a.net_currency || 'UAH',
    status: a.status || 'pending'
  };
}

function normalizeDeduction(d) {
  return {
    deduction_id: d.deduction_id || '',
    accrual_id: d.accrual_id || '',
    owner_id: d.owner_id || '',
    deduction_type: d.deduction_type || '',
    deduction_category: d.deduction_category || '',
    rate_pct: d.rate_pct || '',
    base_amount: toNum(d.base_amount || 0),
    deduction_amount: toNum(d.deduction_amount || 0),
    deduction_amount_uah: toNum(d.deduction_amount_uah || d.deduction_amount || 0),
    currency: d.currency || 'UAH',
    contour_id: d.contour_id || '',
    contour_name: d.contour_name || '',
    status: d.status || 'pending',
    expense_period: d.expense_period || ''
  };
}

function normalizePayout(p) {
  return {
    payout_id: p.payout_id || '',
    owner_id: p.owner_id || '',
    payout_date: formatDate(p.payout_date),
    amount: toNum(p.amount || p.payout_amount),
    currency: p.currency || 'UAH',
    amount_uah: toNum(p.amount_uah || p.amount || p.payout_amount),
    source_account_id: p.source_account_id || '',
    source_account_name: p.source_account_name || '',
    funding_type: p.funding_type || 'direct',
    status: p.status || 'executed'
  };
}

function normalizeInternal(i) {
  return {
    internal_id: i.internal_id || '',
    operation_date: formatDate(i.operation_date),
    operation_type: i.operation_type || '',
    source_contour_id: i.source_contour_id || '',
    source_contour_name: i.source_contour_name || '',
    target_contour_id: i.target_contour_id || '',
    target_contour_name: i.target_contour_name || '',
    amount: toNum(i.amount),
    currency: i.currency || 'UAH',
    amount_uah: toNum(i.amount_uah || i.amount),
    status: i.status || 'completed'
  };
}

function normalizeConversion(c) {
  return {
    conversion_id: c.conversion_id || '',
    conversion_date: formatDate(c.conversion_date),
    source_currency: c.source_currency || 'UAH',
    target_currency: c.target_currency || 'USDT',
    amount_source: toNum(c.amount_source || 0),
    amount_target: toNum(c.amount_target || 0),
    fx_rate: toNum(c.fx_rate || 0),
    amount_nbu: toNum(c.amount_nbu || 0),
    amount_sale: toNum(c.amount_sale || 0),
    status: c.status || 'completed'
  };
}

function normalizeOwnerBalance(o) {
  return {
    owner_id: o.owner_id || '',
    owner_name: o.owner_name || '',
    total_gross: toNum(o.total_gross || o.accrued_gross || 0),
    total_deductions: toNum(o.total_deductions || 0),
    total_net: toNum(o.total_net || o.net_to_pay || 0),
    total_paid: toNum(o.total_paid || 0),
    total_owner_expenses: toNum(o.total_owner_expenses || o.opex_total || 0),
    balance_due: toNum(o.balance_due || o.debt || 0)
  };
}

function normalizeContourBalance(c) {
  return {
    contour_id: c.contour_id || '',
    contour_name: c.contour_name || '',
    contour_type: c.contour_type || '',
    balance: toNum(c.balance || 0)
  };
}

// ========== УТИЛИТЫ ==========
function toNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // Уже строка ISO
  return String(val).substring(0, 10);
}

// ========== ТЕСТ ==========
function testDoGet() {
  const result = doGet({ parameter: { owner: 'OWN-002' } });
  const json = JSON.parse(result.getContent());
  Logger.log('Receipts: ' + json.receipts.length);
  Logger.log('Accruals: ' + json.accruals.length);
  Logger.log('Deductions: ' + json.deductions.length);
  Logger.log('Payouts: ' + json.payouts.length);
  Logger.log('Owner balance: ' + JSON.stringify(json.owner_aggregates));
}
