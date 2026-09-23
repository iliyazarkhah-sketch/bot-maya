// بررسی وضعیت Webhook تلگرام — برای عیب‌یابی
exports.handler = async () => {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    return { statusCode: 500, body: 'TELEGRAM_BOT_TOKEN تنظیم نشده است.' };
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
  const data = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data, null, 2)
  };
};
