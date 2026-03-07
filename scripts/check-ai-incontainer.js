// Run from container: node scripts/check-ai-incontainer.js (no dotenv)
const url = process.env.AI_SERVICE_URL || 'http://ai-microservice:3380';
const timeout = 15000;
console.log('AI_SERVICE_URL:', url, 'Timeout:', timeout, 'ms');

async function run() {
  const t0 = Date.now();
  try {
    const r1 = await fetch(url + '/health', { signal: AbortSignal.timeout(timeout) });
    await r1.text();
    console.log('1. GET /health:', Date.now() - t0, 'ms OK');
    const r2 = await fetch(url + '/api/email-triage/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: 'ck',
        tenant_id: 'ck',
        timestamp: new Date().toISOString(),
        sender: 'x',
        recipients: ['y'],
        subject: 's',
        body_plain: 'b',
        attachments: []
      }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await r2.json();
    console.log('2. POST /ingest:', data.success ? 'OK' : 'FAIL', JSON.stringify(data).slice(0, 150));
  } catch (e) {
    console.log('ERROR after', Date.now() - t0, 'ms:', (e.cause || e).code || '', e.message);
    process.exitCode = 1;
  }
}
run();
