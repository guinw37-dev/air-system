// LINE webhook (PUBLIC — LINE เรียกเอง). ใช้หา group id ของบอท:
//   เพิ่มบอทเข้ากลุ่ม → พิมพ์ข้อความ → บอทตอบ groupId กลับในกลุ่ม + log ไว้.
// ตั้ง Webhook URL ใน LINE console = https://<backend>/api/line/webhook
const express = require('express');
const router = express.Router();

const { getLineToken } = require('../jobs/lineDailyDigest');
async function reply(replyToken, text) {
  const token = await getLineToken();
  if (!token || !replyToken) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  } catch (e) { console.error('[line] reply failed:', e.message); }
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ตอบเร็วก่อนเสมอ (LINE ต้องการ 200)
  const events = (req.body && req.body.events) || [];
  for (const ev of events) {
    const src = ev.source || {};
    const id = src.groupId || src.roomId || src.userId;
    const kind = src.groupId ? 'group' : src.roomId ? 'room' : 'user';
    console.log(`[line] webhook ${ev.type} from ${kind} id=${id}`);
    // มีคนพิมพ์ในกลุ่ม → ตอบ groupId กลับ (เอาไว้ก๊อปไปตั้ง clients.line_group_id)
    if (ev.type === 'message' && (src.groupId || src.roomId)) {
      await reply(ev.replyToken, `LINE ${kind} id:\n${id}\n\nนำ id นี้ไปตั้งให้สาขาในระบบ (clients.line_group_id)`);
    }
  }
});

module.exports = router;
