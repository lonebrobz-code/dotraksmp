const crypto = require('crypto');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const normName = (v) => sha256(String(v || '').trim().toLowerCase().replace(/\s/g, ''));
const normPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '82' + d.slice(1);
  else if (!d.startsWith('82')) d = '82' + d;
  return sha256(d);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { name, phone, area, agreeMarketing, eventId, fbp, fbc, sourceUrl } = req.body || {};
  if (!name || !phone || !eventId) return res.status(400).json({ ok: false });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = req.headers['user-agent'];

  const tasks = [];

  // ① 메타 CAPI
  tasks.push(
    fetch(`https://graph.facebook.com/v21.0/${process.env.PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: process.env.META_TOKEN,
        data: [{
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          event_source_url: sourceUrl,
          user_data: {
            ph: [normPhone(phone)],
            fn: [normName(name)],
            client_ip_address: ip,
            client_user_agent: ua,
            fbp: fbp || undefined,
            fbc: fbc || undefined
          },
          custom_data: { content_name: area || '미선택' }
        }]
        // 테스트할 때만 아래 줄의 주석을 풀고 코드를 넣으세요
        // , test_event_code: 'TEST00000'
      })
    }).then(r => r.json()).then(out => {
      if (out.error) console.error('[CAPI 오류]', JSON.stringify(out.error));
      return out;
    })
  );

  // ② 구글 시트 백업
  if (process.env.BACKUP_WEBHOOK) {
    tasks.push(
      fetch(process.env.BACKUP_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, area, agreeMarketing })
      })
    );
  }

  // ③ 부스터 중계 (스펙 받으면 환경변수만 채우면 작동)
  if (process.env.BOOSTER_ENDPOINT) {
    tasks.push(
      fetch(process.env.BOOSTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.BOOSTER_KEY ? { Authorization: `Bearer ${process.env.BOOSTER_KEY}` } : {})
        },
        body: JSON.stringify({
          code: 'sceuulys',
          name, phone,
          category: area,
          agree_marketing: !!agreeMarketing
        })
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error('[전송 실패 #' + i + ']', name, phone, r.reason);
  });

  return res.status(200).json({ ok: true });
};
