// این فایل فقط یک‌بار استفاده می‌شود: وصل کردن Webhook تلگرام از سمت سرور Netlify
// چون سرور Netlify داخل ایران نیست، دیگر مشکل فیلترینگ برای این درخواست وجود ندارد.
// بعد از استفاده، بازدید از این آدرس مشکلی ایجاد نمی‌کند (setWebhook را می‌شود چندبار زد).

exports.handler = async () => {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL;

  if (!TOKEN) {
    return { statusCode: 500, body: 'TELEGRAM_BOT_TOKEN تنظیم نشده است.' };
  }
  if (!SITE_URL) {
    return { statusCode: 500, body: 'آدرس سایت پیدا نشد.' };
  }

  const webhookUrl = `${SITE_URL}/.netlify/functions/bot`;
  const res = await fetch(
    `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
  );
  const data = await res.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ webhookUrl, telegramResponse: data }, null, 2)
  };
};
