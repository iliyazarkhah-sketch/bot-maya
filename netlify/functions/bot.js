// ربات تلگرامی فروشگاه — ثبت سفارش + گفتگوی پشتیبانی
// نویسنده: ساخته‌شده برای نوین گرافیک

const { getStore } = require('@netlify/blobs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || '');
const API = `https://api.telegram.org/bot${TOKEN}`;

// ---------- ابزارهای تلگرام ----------

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

const sendMessage = (chatId, text, keyboard) =>
  tg('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });

const sendPhoto = (chatId, fileId, caption, keyboard) =>
  tg('sendPhoto', {
    chat_id: chatId,
    photo: fileId,
    caption,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });

const editKeyboard = (chatId, messageId, keyboard) =>
  tg('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard }
  });

const answerCallback = (id, text) =>
  tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });

// ---------- ذخیره‌سازی (Netlify Blobs) ----------

const sessionsStore = () => getStore('bot-sessions');
const ordersStore = () => getStore('bot-orders');
const metaStore = () => getStore('bot-meta');

async function getSession(chatId) {
  const raw = await sessionsStore().get(String(chatId));
  return raw ? JSON.parse(raw) : { state: 'idle' };
}
async function setSession(chatId, data) {
  await sessionsStore().set(String(chatId), JSON.stringify(data));
}

async function getOrder(id) {
  const raw = await ordersStore().get(String(id));
  return raw ? JSON.parse(raw) : null;
}
async function setOrder(order) {
  await ordersStore().set(String(order.id), JSON.stringify(order));
}
async function listOrders() {
  const { blobs } = await ordersStore().list();
  const orders = [];
  for (const b of blobs) {
    const raw = await ordersStore().get(b.key);
    if (raw) orders.push(JSON.parse(raw));
  }
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}
async function nextOrderId() {
  const raw = await metaStore().get('order-counter');
  const next = (raw ? parseInt(raw, 10) : 0) + 1;
  await metaStore().set('order-counter', String(next));
  return next;
}

// ---------- کیبوردها ----------

const BACK_MAIN = [{ text: '🔙 بازگشت', callback_data: 'back:main' }];
const BACK_ADMIN = [{ text: '🔙 بازگشت', callback_data: 'back:admin' }];

function mainMenuKeyboard() {
  return [
    [{ text: '💬 گفتگو با فروشگاه', callback_data: 'menu_chat' }],
    [{ text: '🛒 ثبت سفارش', callback_data: 'menu_order' }]
  ];
}

function adminMenuKeyboard() {
  return [[{ text: '📋 مشاهده تمام سفارش‌ها', callback_data: 'admin_orders' }]];
}

const STATUS_LABELS = {
  step1: 'سفارش در حال آماده‌سازی است',
  step2: 'سفارش در حال بسته‌بندی است',
  step3: 'سفارش به پستچی تحویل داده شد',
  step4: 'ارسال کد رهگیری سفارش'
};

function orderKeyboard(order) {
  if (order.status === 'pending') {
    return [
      [{ text: '✅ تایید سفارش', callback_data: `order_confirm:${order.id}` }],
      BACK_ADMIN
    ];
  }
  const rows = [1, 2, 3, 4].map((n) => {
    const key = `step${n}`;
    if (order.steps[key]) {
      return [{ text: '✅ برای کاربر ارسال شد', callback_data: 'noop' }];
    }
    return [{ text: STATUS_LABELS[key], callback_data: `order_step:${order.id}:${n}` }];
  });
  rows.push(BACK_ADMIN);
  return rows;
}

function orderCaption(order) {
  return (
    `🧾 سفارش #${order.id}\n` +
    `👤 مشتری: ${order.customerName}\n` +
    `🆔 چت آیدی: ${order.customerChatId}\n\n` +
    `📝 اطلاعات سفارش:\n${order.infoText}\n\n` +
    `وضعیت: ${order.status === 'pending' ? '⏳ در انتظار تایید' : '✅ تایید شده'}`
  );
}

// ---------- منطق اصلی ----------

async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const isAdmin = String(chatId) === ADMIN_CHAT_ID;
  const text = msg.text || '';

  if (text === '/start') {
    await setSession(chatId, { state: 'idle' });
    if (isAdmin) {
      await sendMessage(chatId, '🛠 پنل مدیریت فروشگاه', adminMenuKeyboard());
    } else {
      await sendMessage(chatId, 'چه کاری می‌خواهید انجام دهید؟', mainMenuKeyboard());
    }
    return;
  }

  const session = await getSession(chatId);

  // ---- مسیر ادمین ----
  if (isAdmin) {
    if (session.state && session.state.startsWith('wait_reply_to:')) {
      const targetChatId = session.state.split(':')[1];
      const round = (session.round || 1) + 1;
      await setSession(chatId, { state: 'idle' });
      const userKeyboard = [[{ text: '↩️ پاسخ', callback_data: 'chat_continue' }], BACK_MAIN];
      await sendMessage(targetChatId, `پاسخ فروشگاه:\n${text}`, userKeyboard);
      // به‌روزرسانی دور گفتگوی مشتری برای اینکه پیام بعدی‌اش دکمهٔ پایان گفتگو داشته باشد
      const custSession = await getSession(targetChatId);
      await setSession(targetChatId, { ...custSession, state: 'chat_active', round });
      return;
    }
    if (session.state && session.state.startsWith('wait_tracking:')) {
      const orderId = session.state.split(':')[1];
      const order = await getOrder(orderId);
      if (order) {
        order.trackingCode = text;
        order.steps.step4 = true;
        await setOrder(order);
        await sendMessage(order.customerChatId, `📦 کد رهگیری بسته شما: ${text}`);
      }
      await setSession(chatId, { state: 'idle' });
      await sendMessage(chatId, '✅ کد رهگیری برای مشتری ارسال شد.', adminMenuKeyboard());
      return;
    }
    // پیام آزاد ادمین بدون حالت خاص
    await sendMessage(chatId, '🛠 پنل مدیریت فروشگاه', adminMenuKeyboard());
    return;
  }

  // ---- مسیر مشتری ----
  if (session.state === 'chat_active') {
    const round = (session.round || 1);
    const nextRound = round + 1;
    const buttons = [{ text: '↩️ پاسخ', callback_data: `chat_reply:${chatId}` }];
    if (round >= 2) {
      buttons.push({ text: '🔚 پایان گفتگو', callback_data: `chat_end:${chatId}` });
    }
    const customerName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') ||
      msg.from.username || 'کاربر';
    await sendMessage(
      ADMIN_CHAT_ID,
      `💬 پیام جدید از ${customerName} (${chatId}):\n${text}`,
      [buttons]
    );
    await setSession(chatId, { state: 'chat_active', round: nextRound });
    return;
  }

  if (session.state === 'chat_ended') {
    await sendMessage(chatId, 'گفتگوی شما به پایان رسیده است. برای شروع دوباره روی دکمه زیر بزنید.', [
      [{ text: '🔄 شروع گفتگوی مجدد', callback_data: 'menu_chat' }]
    ]);
    return;
  }

  if (session.state === 'order_wait_info') {
    const order = await getOrder(session.orderId);
    order.infoText = text || msg.caption || '(بدون متن)';
    await setOrder(order);
    await setSession(chatId, { state: 'order_wait_receipt', orderId: order.id });
    await sendMessage(chatId, 'لطفاً عکس فیش واریزی خود را ارسال کنید.');
    return;
  }

  if (session.state === 'order_wait_receipt') {
    if (!msg.photo || msg.photo.length === 0) {
      await sendMessage(chatId, 'لطفاً برای تکمیل سفارش، عکس فیش واریزی خود را ارسال کنید.');
      return;
    }
    const order = await getOrder(session.orderId);
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    order.receiptFileId = fileId;
    order.status = 'pending';
    await setOrder(order);
    await setSession(chatId, { state: 'idle' });
    await sendMessage(
      chatId,
      'سفارش شما برای فروشگاه ارسال شد. پس از تایید سفارش به شما اطلاع‌رسانی می‌شود.'
    );
    await sendPhoto(ADMIN_CHAT_ID, fileId, orderCaption(order), orderKeyboard(order));
    return;
  }

  // حالت پیش‌فرض: نمایش منو
  await sendMessage(chatId, 'چه کاری می‌خواهید انجام دهید؟', mainMenuKeyboard());
}

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const isAdmin = String(chatId) === ADMIN_CHAT_ID;
  const data = cq.data;

  await answerCallback(cq.id);

  if (data === 'noop') return;

  // ---- بازگشت ----
  if (data === 'back:main') {
    await setSession(chatId, { state: 'idle' });
    await sendMessage(chatId, 'چه کاری می‌خواهید انجام دهید؟', mainMenuKeyboard());
    return;
  }
  if (data === 'back:admin') {
    await setSession(chatId, { state: 'idle' });
    await sendMessage(chatId, '🛠 پنل مدیریت فروشگاه', adminMenuKeyboard());
    return;
  }

  // ---- منوی مشتری ----
  if (data === 'menu_chat') {
    await setSession(chatId, { state: 'chat_active', round: 1 });
    await sendMessage(chatId, 'پیام خود را بنویسید:', [BACK_MAIN]);
    return;
  }
  if (data === 'chat_continue') {
    await setSession(chatId, { state: 'chat_active', round: 1 });
    await sendMessage(chatId, 'پیام خود را بنویسید:', [BACK_MAIN]);
    return;
  }

  if (data === 'menu_order') {
    const id = await nextOrderId();
    const customerName = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') ||
      cq.from.username || 'کاربر';
    const order = {
      id,
      customerChatId: chatId,
      customerName,
      infoText: '',
      receiptFileId: '',
      status: 'draft',
      steps: { step1: false, step2: false, step3: false, step4: false },
      trackingCode: '',
      createdAt: Date.now()
    };
    await setOrder(order);
    await setSession(chatId, { state: 'order_wait_info', orderId: id });
    await sendMessage(chatId, 'لطفاً اطلاعاتی که در سایت کپی کردید را ارسال کنید.');
    return;
  }

  // ---- گفتگو: پاسخ ادمین ----
  if (data.startsWith('chat_reply:')) {
    const targetChatId = data.split(':')[1];
    await setSession(chatId, { state: `wait_reply_to:${targetChatId}` });
    await sendMessage(chatId, 'متن پاسخ خود را بنویسید:', [BACK_ADMIN]);
    return;
  }

  // ---- گفتگو: پایان توسط ادمین ----
  if (data.startsWith('chat_end:')) {
    const targetChatId = data.split(':')[1];
    await setSession(targetChatId, { state: 'chat_ended' });
    await sendMessage(
      targetChatId,
      'گفتگوی شما به پایان رسید. برای شروع دوباره گفتگو، روی دکمهٔ شروع گفتگو مجدد کلیک کنید.',
      [[{ text: '🔄 شروع گفتگوی مجدد', callback_data: 'menu_chat' }]]
    );
    await editKeyboard(chatId, messageId, [[{ text: '🔚 گفتگو پایان یافت', callback_data: 'noop' }]]);
    return;
  }

  // ---- تایید سفارش ----
  if (data.startsWith('order_confirm:')) {
    const orderId = data.split(':')[1];
    const order = await getOrder(orderId);
    if (order) {
      order.status = 'confirmed';
      await setOrder(order);
      await sendMessage(order.customerChatId, '✅ سفارش شما تایید شد.');
      await editKeyboard(chatId, messageId, orderKeyboard(order));
    }
    return;
  }

  // ---- مراحل وضعیت سفارش ----
  if (data.startsWith('order_step:')) {
    const [, orderId, stepStr] = data.split(':');
    const step = parseInt(stepStr, 10);
    const order = await getOrder(orderId);
    if (!order) return;

    if (step === 4) {
      await setSession(chatId, { state: `wait_tracking:${orderId}` });
      await sendMessage(chatId, 'لطفاً کد رهگیری سفارش را ارسال کنید.', [BACK_ADMIN]);
      return;
    }

    order.steps[`step${step}`] = true;
    await setOrder(order);
    await sendMessage(order.customerChatId, `📦 ${STATUS_LABELS[`step${step}`]}`);
    await editKeyboard(chatId, messageId, orderKeyboard(order));
    return;
  }

  // ---- پنل ادمین: لیست سفارش‌ها ----
  if (data === 'admin_orders' && isAdmin) {
    const orders = await listOrders();
    if (orders.length === 0) {
      await sendMessage(chatId, 'هنوز سفارشی ثبت نشده است.', [BACK_ADMIN]);
      return;
    }
    const rows = orders.map((o) => [
      {
        text: `#${o.id} - ${o.customerName} - ${o.status === 'pending' ? '⏳' : '✅'}`,
        callback_data: `admin_order:${o.id}`
      }
    ]);
    rows.push(BACK_ADMIN);
    await sendMessage(chatId, '📋 لیست سفارش‌ها:', rows);
    return;
  }

  if (data.startsWith('admin_order:') && isAdmin) {
    const orderId = data.split(':')[1];
    const order = await getOrder(orderId);
    if (!order) {
      await sendMessage(chatId, 'سفارش پیدا نشد.', [BACK_ADMIN]);
      return;
    }
    await sendPhoto(chatId, order.receiptFileId, orderCaption(order), orderKeyboard(order));
    return;
  }
}

// ---------- ورودی Netlify Function ----------

exports.handler = async (event) => {
  try {
    const update = JSON.parse(event.body || '{}');
    await handleUpdate(update);
  } catch (err) {
    console.error(err);
  }
  return { statusCode: 200, body: 'ok' };
};
