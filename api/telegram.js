// Vercel Serverless Function — Telegram Bot Webhook
// Reads live data from Google Sheets via Apps Script Web App API

const TG_TOKEN = process.env.TG_BOT_TOKEN || '7949481988:AAHHdwsz2jHV0VwW7ZHu4QeHhxSsGkgiuLw';
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyMW-PW06ahc-V5p0OF1RS4ugm9IBHg5IeniDuGrrwIz0_1FXdJsUunUo544e-2OXD9yQ/exec';
const DASHBOARD_URL = 'https://kazna-dashboard.vercel.app';

// ========== MAIN HANDLER ==========
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, method: 'GET — webhook is alive' });
  }

  try {
    const { message } = req.body || {};
    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const firstName = message.from?.first_name || '';

    // Route commands
    if (text === '/start' || text === '/help') {
      await cmdStart(chatId, firstName);
    } else if (text === '/balance' || text === '/баланс') {
      await cmdBalance(chatId);
    } else if (text === '/today' || text === '/сьогодні') {
      await cmdToday(chatId);
    } else if (text === '/week' || text === '/тиждень') {
      await cmdPeriod(chatId, 7, 'тиждень');
    } else if (text === '/month' || text === '/місяць') {
      await cmdPeriod(chatId, 30, 'місяць');
    } else if (text === '/fees' || text === '/комісії') {
      await cmdFees(chatId);
    } else if (text === '/payouts' || text === '/виплати') {
      await cmdPayouts(chatId);
    } else if (text === '/dashboard') {
      await sendTg(chatId, `🌐 [Відкрити дашборд](${esc(DASHBOARD_URL)})`, 'MarkdownV2');
    } else {
      await sendTg(chatId, '🤔 Невідома команда. Натисніть /help для списку команд.');
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }

  return res.status(200).json({ ok: true });
};

// ========== COMMANDS ==========

async function cmdStart(chatId, name) {
  const msg = `👋 Привіт, ${esc(name || 'друже')}\\!\n\n`
    + `🏦 Я бот *Казначейства*\\. Допоможу стежити за фінансами\\.\n\n`
    + `📊 Команди:\n`
    + `/balance — 💰 Баланс до виплати\n`
    + `/today — 📅 Надходження сьогодні\n`
    + `/week — 📆 За тиждень\n`
    + `/month — 🗓 За місяць\n`
    + `/fees — 📉 Комісії та утримання\n`
    + `/payouts — 💸 Останні виплати\n`
    + `/dashboard — 🌐 Посилання на дашборд\n`
    + `/help — ❓ Допомога`;

  await sendTg(chatId, msg, 'MarkdownV2');
}

async function cmdBalance(chatId) {
  const data = await fetchData();
  if (!data) { await sendTg(chatId, '❌ Помилка отримання даних'); return; }

  const lines = ['💰 *Баланси власників:*\n'];

  for (const ob of data.owner_balances) {
    if (!ob.owner_id) continue;
    const bal = ob.balance_due || 0;
    const emoji = bal >= 0 ? '🟢' : '🔴';
    lines.push(`${emoji} *${esc(ob.owner_name || ob.owner_id)}*`);
    lines.push(`   Баланс: \`${fmtMoney(bal)} UAH\``);
    lines.push(`   Нетто: \`${fmtMoney(ob.total_net || 0)} UAH\``);
    lines.push(`   Виплачено: \`${fmtMoney(ob.total_paid || 0)} UAH\``);
    lines.push('');
  }

  await sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

async function cmdToday(chatId) {
  const data = await fetchData();
  if (!data) { await sendTg(chatId, '❌ Помилка отримання даних'); return; }

  const today = new Date().toISOString().substring(0, 10);
  const todayReceipts = data.receipts.filter(r => String(r.receipt_date).substring(0, 10) === today);

  if (todayReceipts.length === 0) {
    await sendTg(chatId, `📅 Сьогодні \\(${esc(today)}\\) надходжень ще немає\\.`, 'MarkdownV2');
    return;
  }

  let total = 0;
  const lines = [`📅 *Надходження сьогодні* \\(${esc(today)}\\):\n`];

  for (const r of todayReceipts) {
    const amt = r.amount_uah || r.amount || 0;
    total += amt;
    lines.push(`• ${esc(r.course_name || '—')}: \`${fmtMoney(amt)} UAH\``);
  }

  lines.push(`\n💵 *Разом: \`${fmtMoney(total)} UAH\`* \\(${todayReceipts.length} шт\\.\\)`);
  await sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

async function cmdPeriod(chatId, days, label) {
  const data = await fetchData();
  if (!data) { await sendTg(chatId, '❌ Помилка отримання даних'); return; }

  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000);
  const sinceStr = since.toISOString().substring(0, 10);
  const nowStr = now.toISOString().substring(0, 10);

  const filtered = data.receipts.filter(r => {
    const d = String(r.receipt_date).substring(0, 10);
    return d >= sinceStr;
  });

  let totalAll = 0;
  const byOwner = {};

  for (const r of filtered) {
    const amt = r.amount_uah || r.amount || 0;
    totalAll += amt;
    const own = r.owner_name || r.owner_id || 'Невідомий';
    if (!byOwner[own]) byOwner[own] = { count: 0, sum: 0 };
    byOwner[own].count++;
    byOwner[own].sum += amt;
  }

  const lines = [`📊 *Надходження за ${esc(label)}*\n`];
  lines.push(`📅 Період: ${esc(sinceStr)} — ${esc(nowStr)}\n`);

  for (const [own, d] of Object.entries(byOwner)) {
    lines.push(`👤 *${esc(own)}*: \`${fmtMoney(d.sum)} UAH\` \\(${d.count} шт\\.\\)`);
  }

  lines.push(`\n💵 *Разом: \`${fmtMoney(totalAll)} UAH\`* \\(${filtered.length} надходжень\\)`);

  const avgDay = days > 0 ? totalAll / days : 0;
  lines.push(`📈 Середнє/день: \`${fmtMoney(avgDay)} UAH\``);

  await sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

async function cmdFees(chatId) {
  const data = await fetchData();
  if (!data) { await sendTg(chatId, '❌ Помилка отримання даних'); return; }

  const byType = {};
  for (const d of data.deductions) {
    const type = d.deduction_type || 'інше';
    const amt = d.deduction_amount_uah || d.deduction_amount || 0;
    byType[type] = (byType[type] || 0) + amt;
  }

  const typeNames = {
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

  let total = 0;
  const lines = ['📉 *Утримання по типах:*\n'];

  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  for (const [type, amt] of sorted) {
    total += amt;
    const name = typeNames[type] || type;
    lines.push(`${esc(name)}: \`${fmtMoney(amt)} UAH\``);
  }

  lines.push(`\n💰 *Разом утримано: \`${fmtMoney(total)} UAH\`*`);
  await sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

async function cmdPayouts(chatId) {
  const data = await fetchData();
  if (!data) { await sendTg(chatId, '❌ Помилка отримання даних'); return; }

  const payouts = [...data.payouts].sort((a, b) =>
    String(b.payout_date || '').localeCompare(String(a.payout_date || ''))
  ).slice(0, 10);

  const lines = ['💸 *Останні виплати:*\n'];

  for (const p of payouts) {
    const amt = p.amount || p.amount_uah || 0;
    const curr = p.currency || 'UAH';
    const acct = p.source_account_name || p.source_account_id || '';
    const owner = p.owner_name || p.owner_id || '';
    const date = String(p.payout_date || '').substring(0, 10);

    lines.push(`📅 ${esc(date)} · *${esc(owner)}*`);
    lines.push(`   \`${fmtMoney(amt)} ${esc(curr)}\` · ${esc(acct)}`);
    lines.push('');
  }

  await sendTg(chatId, lines.join('\n'), 'MarkdownV2');
}

// ========== DATA FETCHING ==========

async function fetchData(owner) {
  try {
    const url = owner ? `${WEBAPP_URL}?owner=${owner}` : WEBAPP_URL;
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.error('fetchData error:', err);
    return null;
  }
}

// ========== TELEGRAM API ==========

async function sendTg(chatId, text, parseMode) {
  const payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true
  };
  if (parseMode) payload.parse_mode = parseMode;

  try {
    const resp = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await resp.json();

    if (!body.ok && parseMode) {
      // Retry without markdown
      payload.parse_mode = undefined;
      payload.text = text.replace(/\\([!._\-\[\](){}+=#|>~`])/g, '$1');
      await fetch(`${TG_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    return body;
  } catch (err) {
    console.error('sendTg error:', err);
  }
}

// ========== HELPERS ==========

function fmtMoney(num) {
  return Number(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',');
}

function esc(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
