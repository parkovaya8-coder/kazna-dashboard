// ================================================================
// FILE: 93_telegram_bot.gs
// Telegram-бот для казначейства
// ================================================================

var TG_TOKEN = '7949481988:AAHHdwsz2jHV0VwW7ZHu4QeHhxSsGkgiuLw';
var TG_API = 'https://api.telegram.org/bot' + TG_TOKEN;

// Авторизованные chat_id (заполняется после /start)
var AUTHORIZED_CHATS = null; // загружается из Properties

// ========== WEBHOOK HANDLER ==========
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var message = data.message;
    if (!message) return ContentService.createTextOutput('ok');

    var chatId = message.chat.id;
    var text = (message.text || '').trim();

    // Сохраняем chat_id для push-уведомлений
    saveChatId(chatId);

    // Роутинг команд
    if (text === '/start') {
      cmdStart(chatId, message.from);
    } else if (text === '/balance' || text === '/баланс') {
      cmdBalance(chatId);
    } else if (text === '/today' || text === '/сьогодні' || text === '/сегодня') {
      cmdToday(chatId);
    } else if (text === '/week' || text === '/тиждень' || text === '/неделя') {
      cmdPeriod(chatId, 7, 'тиждень');
    } else if (text === '/month' || text === '/місяць' || text === '/месяц') {
      cmdPeriod(chatId, 30, 'місяць');
    } else if (text === '/fees' || text === '/комісії') {
      cmdFees(chatId);
    } else if (text === '/payouts' || text === '/виплати') {
      cmdPayouts(chatId);
    } else if (text === '/help' || text === '/допомога') {
      cmdHelp(chatId);
    } else if (text === '/dashboard') {
      cmdDashboard(chatId);
    } else {
      sendTg(chatId, '🤔 Невідома команда. Натисніть /help для списку команд.');
    }

  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
  }

  return ContentService.createTextOutput('ok');
}

// ========== COMMANDS ==========

function cmdStart(chatId, from) {
  var name = from.first_name || 'друже';
  var msg = '👋 Привіт, ' + name + '\\!\n\n'
    + '🏦 Я бот *Казначейства*\\. Допоможу стежити за фінансами\\.\n\n'
    + '📊 Команди:\n'
    + '/balance — 💰 Баланс до виплати\n'
    + '/today — 📅 Надходження сьогодні\n'
    + '/week — 📆 За тиждень\n'
    + '/month — 🗓 За місяць\n'
    + '/fees — 📉 Комісії та утримання\n'
    + '/payouts — 💸 Останні виплати\n'
    + '/dashboard — 🌐 Посилання на дашборд\n'
    + '/help — ❓ Допомога\n\n'
    + '🔔 Я буду надсилати сповіщення про нові надходження та щоденну зведку о 09:00\\.';

  sendTg(chatId, msg, 'MarkdownV2');
}

function cmdBalance(chatId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var balSheet = ss.getSheetByName(SHEET_NAMES.LED_OWNER_BALANCE);
  if (!balSheet) { sendTg(chatId, '❌ Лист балансів не знайдено'); return; }

  var data = getSheetRows(balSheet);
  var lines = ['💰 *Баланси власників:*\n'];

  data.forEach(function(row) {
    if (!row.owner_id) return;
    var bal = toNumTg(row.balance_due || row.debt || 0);
    var emoji = bal >= 0 ? '🟢' : '🔴';
    lines.push(emoji + ' *' + escMd(row.owner_name || row.owner_id) + '*');
    lines.push('   Баланс: `' + fmtMoney(bal) + ' UAH`');
    lines.push('   Нетто: `' + fmtMoney(toNumTg(row.total_net || row.net_to_pay || 0)) + ' UAH`');
    lines.push('   Виплачено: `' + fmtMoney(toNumTg(row.total_paid || 0)) + ' UAH`');
    lines.push('');
  });

  sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

function cmdToday(chatId) {
  var today = new Date();
  var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rcpSheet = ss.getSheetByName(SHEET_NAMES.OPS_RECEIPTS);
  if (!rcpSheet) { sendTg(chatId, '❌ Лист надходжень не знайдено'); return; }

  var rows = getSheetRows(rcpSheet);
  var todayReceipts = rows.filter(function(r) {
    var d = r.receipt_date;
    if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return String(d).substring(0, 10) === todayStr;
  });

  if (todayReceipts.length === 0) {
    sendTg(chatId, '📅 Сьогодні (' + todayStr + ') надходжень ще немає\\.');
    return;
  }

  var total = 0;
  var lines = ['📅 *Надходження сьогодні* \\(' + escMd(todayStr) + '\\):\n'];

  todayReceipts.forEach(function(r) {
    var amt = toNumTg(r.amount_uah || r.amount);
    total += amt;
    lines.push('• ' + escMd(r.course_name || r.course_id || '—') + ': `' + fmtMoney(amt) + ' UAH`');
  });

  lines.push('\n💵 *Разом: `' + fmtMoney(total) + ' UAH`* \\(' + todayReceipts.length + ' шт\\.\\)');
  sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

function cmdPeriod(chatId, days, label) {
  var now = new Date();
  var since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  var sinceStr = Utilities.formatDate(since, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rcpSheet = ss.getSheetByName(SHEET_NAMES.OPS_RECEIPTS);
  var rows = getSheetRows(rcpSheet);

  var filtered = rows.filter(function(r) {
    var d = r.receipt_date;
    if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return String(d).substring(0, 10) >= sinceStr;
  });

  var totalAll = 0;
  var byOwner = {};

  filtered.forEach(function(r) {
    var amt = toNumTg(r.amount_uah || r.amount);
    totalAll += amt;
    var own = r.owner_name || r.owner_id || 'Невідомий';
    if (!byOwner[own]) byOwner[own] = { count: 0, sum: 0 };
    byOwner[own].count++;
    byOwner[own].sum += amt;
  });

  var lines = ['📊 *Надходження за ' + escMd(label) + '*\n'];
  lines.push('📅 Період: ' + escMd(sinceStr) + ' — ' + escMd(Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd')) + '\n');

  Object.keys(byOwner).forEach(function(own) {
    var d = byOwner[own];
    lines.push('👤 *' + escMd(own) + '*: `' + fmtMoney(d.sum) + ' UAH` \\(' + d.count + ' шт\\.\\)');
  });

  lines.push('\n💵 *Разом: `' + fmtMoney(totalAll) + ' UAH`* \\(' + filtered.length + ' надходжень\\)');

  var avgDay = days > 0 ? totalAll / days : 0;
  lines.push('📈 Середнє/день: `' + fmtMoney(avgDay) + ' UAH`');

  sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

function cmdFees(chatId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dedSheet = ss.getSheetByName(SHEET_NAMES.OPS_DEDUCTIONS);
  var rows = getSheetRows(dedSheet);

  var byType = {};
  rows.forEach(function(r) {
    var type = r.deduction_type || 'інше';
    var amt = toNumTg(r.deduction_amount_uah || r.deduction_amount || 0);
    if (!byType[type]) byType[type] = 0;
    byType[type] += amt;
  });

  var total = 0;
  var lines = ['📉 *Утримання по типах:*\n'];

  var typeNames = {
    'wfp_fee': '🏪 Комісія WFP',
    'service_fee': '🔧 Сервісна комісія',
    'tax': '🏛 ЕН (податок)',
    'military_tax': '⚔️ Військовий збір',
    'wfp_prime': '💳 WFP Prime',
    'en_tax_luk': '🏛 ЕН Лукяненко',
    'military_tax_luk': '⚔️ ВЗ Лукяненко',
    'ops_service_fee': '⚙️ Операційна комісія',
    'bank_fee': '🏦 Банківська комісія',
    'crypto_fee': '₿ Крипто комісія'
  };

  Object.keys(byType).sort(function(a, b) { return byType[b] - byType[a]; }).forEach(function(type) {
    var amt = byType[type];
    total += amt;
    var name = typeNames[type] || type;
    lines.push(escMd(name) + ': `' + fmtMoney(amt) + ' UAH`');
  });

  lines.push('\n💰 *Разом утримано: `' + fmtMoney(total) + ' UAH`*');

  sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

function cmdPayouts(chatId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paySheet = ss.getSheetByName(SHEET_NAMES.OPS_PAYOUTS);
  var rows = getSheetRows(paySheet);

  // Последние 10 виплат
  rows.sort(function(a, b) {
    var da = String(a.payout_date || '');
    var db = String(b.payout_date || '');
    return db.localeCompare(da);
  });

  var last10 = rows.slice(0, 10);
  var lines = ['💸 *Останні виплати:*\n'];

  last10.forEach(function(p) {
    var date = p.payout_date;
    if (date instanceof Date) date = Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var amt = toNumTg(p.amount || p.payout_amount || 0);
    var curr = p.currency || 'UAH';
    var acct = p.source_account_name || p.source_account_id || '';
    var owner = p.owner_name || p.owner_id || '';

    lines.push('📅 ' + escMd(String(date)) + ' · *' + escMd(owner) + '*');
    lines.push('   `' + fmtMoney(amt) + ' ' + escMd(curr) + '` · ' + escMd(acct));
    lines.push('');
  });

  sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

function cmdDashboard(chatId) {
  sendTg(chatId, '🌐 [Відкрити дашборд](https://kazna\\-dashboard\\.vercel\\.app)', 'MarkdownV2');
}

function cmdHelp(chatId) {
  cmdStart(chatId, { first_name: '' });
}

// ========== PUSH NOTIFICATIONS ==========

/**
 * Надсилає сповіщення про нове надходження всім підписаним чатам.
 * Викликається з 10_ops_receipts.js після створення нового надходження.
 */
function notifyNewReceipt(receipt) {
  var chats = getAllChatIds();
  if (!chats.length) return;

  var amt = toNumTg(receipt.amount_uah || receipt.amount || 0);
  var course = receipt.course_name || receipt.course_id || '';
  var owner = receipt.owner_name || receipt.owner_id || '';

  var msg = '🔔 *Нове надходження\\!*\n\n'
    + '💵 Сума: `' + fmtMoney(amt) + ' UAH`\n'
    + '📚 Курс: ' + escMd(course) + '\n'
    + '👤 Власник: ' + escMd(owner) + '\n'
    + '📅 ' + escMd(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'));

  chats.forEach(function(chatId) {
    try { sendTg(chatId, msg, 'MarkdownV2'); } catch(e) { Logger.log('Push failed for ' + chatId + ': ' + e); }
  });
}

/**
 * Щоденна зведка — запускається тригером о 09:00.
 * Створіть Time-driven trigger: dailySummary(), Day timer, 9am to 10am
 */
function dailySummary() {
  var chats = getAllChatIds();
  if (!chats.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var yStr = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Надходження вчора
  var rcpSheet = ss.getSheetByName(SHEET_NAMES.OPS_RECEIPTS);
  var rcpRows = getSheetRows(rcpSheet);
  var yReceipts = rcpRows.filter(function(r) {
    var d = r.receipt_date;
    if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return String(d).substring(0, 10) === yStr;
  });

  var yTotal = 0;
  yReceipts.forEach(function(r) { yTotal += toNumTg(r.amount_uah || r.amount || 0); });

  // Баланси
  var balSheet = ss.getSheetByName(SHEET_NAMES.LED_OWNER_BALANCE);
  var balRows = getSheetRows(balSheet);

  var lines = ['☀️ *Доброго ранку\\! Зведка за ' + escMd(yStr) + '*\n'];

  if (yReceipts.length > 0) {
    lines.push('📥 Вчора надійшло: `' + fmtMoney(yTotal) + ' UAH` \\(' + yReceipts.length + ' шт\\.\\)');
  } else {
    lines.push('📥 Вчора надходжень не було');
  }

  lines.push('\n💰 *Баланси:*');
  balRows.forEach(function(row) {
    if (!row.owner_id) return;
    var bal = toNumTg(row.balance_due || row.debt || 0);
    var emoji = bal >= 0 ? '🟢' : '🔴';
    lines.push(emoji + ' ' + escMd(row.owner_name || row.owner_id) + ': `' + fmtMoney(bal) + ' UAH`');
  });

  // Загальна статистика за місяць
  var monthStart = Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var monthReceipts = rcpRows.filter(function(r) {
    var d = r.receipt_date;
    if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return String(d).substring(0, 10) >= monthStart;
  });
  var monthTotal = 0;
  monthReceipts.forEach(function(r) { monthTotal += toNumTg(r.amount_uah || r.amount || 0); });

  lines.push('\n📊 За місяць: `' + fmtMoney(monthTotal) + ' UAH` \\(' + monthReceipts.length + ' надходжень\\)');
  lines.push('\n🌐 [Дашборд](https://kazna\\-dashboard\\.vercel\\.app)');

  var msg = lines.join('\n');
  chats.forEach(function(chatId) {
    try { sendTg(chatId, msg, 'MarkdownV2'); } catch(e) { Logger.log('Daily push failed: ' + e); }
  });
}

// ========== TELEGRAM API ==========

function sendTg(chatId, text, parseMode) {
  var payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true
  };
  if (parseMode) payload.parse_mode = parseMode;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(TG_API + '/sendMessage', options);
  var body = JSON.parse(resp.getContentText());
  if (!body.ok) {
    Logger.log('TG send error: ' + JSON.stringify(body));
    // Retry without parse mode if markdown fails
    if (parseMode) {
      payload.parse_mode = undefined;
      payload.text = text.replace(/\\([!._\-\[\](){}+=#|>~`])/g, '$1');
      options.payload = JSON.stringify(payload);
      UrlFetchApp.fetch(TG_API + '/sendMessage', options);
    }
  }
  return body;
}

// ========== CHAT ID STORAGE ==========

function saveChatId(chatId) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('TG_CHAT_IDS');
  var ids = stored ? JSON.parse(stored) : [];
  if (ids.indexOf(chatId) === -1) {
    ids.push(chatId);
    props.setProperty('TG_CHAT_IDS', JSON.stringify(ids));
    Logger.log('New chat registered: ' + chatId);
  }
}

function getAllChatIds() {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('TG_CHAT_IDS');
  return stored ? JSON.parse(stored) : [];
}

// ========== HELPERS ==========

function getSheetRows(sheet) {
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < WEB_DATA_START_ROW || lastCol < 1) return [];

  var techNames = sheet.getRange(WEB_TECH_ROW, 1, 1, lastCol).getValues()[0];
  var dataRows = sheet.getRange(WEB_DATA_START_ROW, 1, lastRow - WEB_DATA_START_ROW + 1, lastCol).getValues();

  var result = [];
  for (var i = 0; i < dataRows.length; i++) {
    if (!dataRows[i][0] || String(dataRows[i][0]).trim() === '') continue;
    var obj = {};
    for (var j = 0; j < techNames.length; j++) {
      var key = String(techNames[j]).trim();
      if (!key) continue;
      var val = dataRows[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[key] = val;
    }
    result.push(obj);
  }
  return result;
}

function toNumTg(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  var n = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtMoney(num) {
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',');
}

function escMd(text) {
  // Escape special chars for Telegram MarkdownV2
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ========== WEBHOOK SETUP ==========

/**
 * Запустіть один раз, щоб налаштувати webhook.
 * Після цього Telegram буде надсилати повідомлення на Web App URL.
 */
function setTelegramWebhook() {
  var webAppUrl = ScriptApp.getService().getUrl();
  var resp = UrlFetchApp.fetch(TG_API + '/setWebhook?url=' + encodeURIComponent(webAppUrl));
  Logger.log('Webhook set: ' + resp.getContentText());
}

/**
 * Видалити webhook
 */
function removeTelegramWebhook() {
  var resp = UrlFetchApp.fetch(TG_API + '/deleteWebhook');
  Logger.log('Webhook removed: ' + resp.getContentText());
}

/**
 * Перевірити статус webhook
 */
function checkTelegramWebhook() {
  var resp = UrlFetchApp.fetch(TG_API + '/getWebhookInfo');
  Logger.log('Webhook info: ' + resp.getContentText());
}

/**
 * Налаштувати тригер щоденної зведки.
 * Запустіть один раз.
 */
function setupDailyTrigger() {
  // Видаляємо старі тригери
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'dailySummary') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Створюємо новий — щодня о 09:00
  ScriptApp.newTrigger('dailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('Daily trigger set for 09:00');
}
