const axios = require('axios');
const nodemailer = require('nodemailer');

const NIGHT_CHECK_INTERVAL_MS = 60_000;
const DAY_CHECK_INTERVAL_MS = 10 * 60_000;
const ERROR_RETRY_INTERVAL_MS = 60_000;
const TARGET_URL = 'https://titulosvalidez.educacion.gob.ar/validez/detitulos/';
const BLOCKED_URL =
  'https://titulosvalidez.educacion.gob.ar/validez/detitulos/noaccess.php?sinT=1&msj=Lamentablemente+no+hay+turnos+disponibles+debido+al+alto+nivel+de+demanda.%0APor+favor%2C+vuelva+a+intentar+en+otro+momento.';

const REQUIRED_ENV_VARS = [
  'EMAIL_USER',
  'EMAIL_PASS',
  'EMAIL_TO',
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID'
];

const missingVars = REQUIRED_ENV_VARS.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`[ERRO] Variáveis de ambiente ausentes: ${missingVars.join(', ')}`);
  process.exit(1);
}

function sanitizeEnvValue(value) {
  return String(value || '')
    .replace(/\\n/g, '')
    .trim();
}

const EMAIL_USER = sanitizeEnvValue(process.env.EMAIL_USER);
const EMAIL_PASS = sanitizeEnvValue(process.env.EMAIL_PASS).replace(/\s+/g, '');
const EMAIL_TO = sanitizeEnvValue(process.env.EMAIL_TO);
const TELEGRAM_TOKEN = sanitizeEnvValue(process.env.TELEGRAM_TOKEN);
const TELEGRAM_CHAT_ID = sanitizeEnvValue(process.env.TELEGRAM_CHAT_ID);

if (!EMAIL_USER.includes('@')) {
  console.error('[ERRO] EMAIL_USER inválido. Verifique o valor no .env.');
  process.exit(1);
}

if (EMAIL_PASS.length < 16) {
  console.error(
    '[ERRO] EMAIL_PASS parece inválido. Use uma App Password do Gmail (16 caracteres, espaços serão removidos automaticamente).'
  );
  process.exit(1);
}

const SELF_TEST_MODE = process.argv.includes('--self-test');
const CHECK_ONCE_MODE = process.argv.includes('--check-once');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

function nowIso() {
  return new Date().toISOString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCheckIntervalMs(currentDate = new Date()) {
  const currentHour = currentDate.getHours();

  if (currentHour >= 0 && currentHour < 7) {
    return NIGHT_CHECK_INTERVAL_MS;
  }

  return DAY_CHECK_INTERVAL_MS;
}

async function checkAppointments() {
  const response = await axios.get(TARGET_URL, {
    maxRedirects: 10,
    timeout: 20_000,
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  });

  const finalUrl = response?.request?.res?.responseUrl || TARGET_URL;
  console.log(`[${nowIso()}] Check concluído. URL final: ${finalUrl}`);

  return finalUrl;
}

async function sendEmailNotification(finalUrl) {
  const subject = '🚨 Possível turno disponível!';
  const text = [
    'A URL final retornada foi diferente da URL de bloqueio.',
    '',
    `URL monitorada: ${TARGET_URL}`,
    `URL final: ${finalUrl}`,
    '',
    `Detectado em: ${nowIso()}`
  ].join('\n');

  await transporter.sendMail({
    from: EMAIL_USER,
    to: EMAIL_TO,
    subject,
    text
  });
}

async function sendTelegramNotification(finalUrl) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const text = [
    '🚨 *Possível turno disponível!*',
    '',
    'A URL final retornada foi diferente da URL de bloqueio.',
    `URL monitorada: ${TARGET_URL}`,
    `URL final: ${finalUrl}`,
    `Detectado em: ${nowIso()}`
  ].join('\n');

  await axios.post(
    telegramUrl,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    },
    {
      timeout: 20_000
    }
  );
}

async function notify(finalUrl) {
  await Promise.all([sendEmailNotification(finalUrl), sendTelegramNotification(finalUrl)]);
  console.log(`[${nowIso()}] Notificações enviadas (email + Telegram).`);
}

async function runSelfTest() {
  console.log(`[${nowIso()}] Iniciando auto-teste...`);

  const finalUrl = await checkAppointments();

  console.log(`[${nowIso()}] Enviando notificação de teste para validar integrações.`);
  await notify(finalUrl);

  console.log(`[${nowIso()}] Auto-teste finalizado com sucesso.`);
}

async function runSingleCheck() {
  console.log(`[${nowIso()}] Executando checagem única...`);
  const finalUrl = await checkAppointments();

  if (finalUrl !== BLOCKED_URL) {
    console.log(`[${nowIso()}] Checagem única detectou URL diferente da bloqueada. Notificando.`);
    await notify(finalUrl);
  } else {
    console.log(`[${nowIso()}] Checagem única concluída sem disponibilidade detectada.`);
  }
}

async function monitorLoop() {
  console.log(`[${nowIso()}] Monitor de turnos iniciado.`);

  while (true) {
    try {
      const finalUrl = await checkAppointments();

      if (finalUrl !== BLOCKED_URL) {
        console.log(
          `[${nowIso()}] URL diferente da bloqueada detectada. Enviando notificações imediatamente.`
        );
        await notify(finalUrl);
      }

      const nextIntervalMs = getCheckIntervalMs();
      console.log(
        `[${nowIso()}] Próxima verificação em ${Math.round(nextIntervalMs / 1000)} segundos.`
      );
      await wait(nextIntervalMs);
    } catch (error) {
      const errorMessage = error?.message || 'Erro desconhecido';
      console.error(`[${nowIso()}] Erro de rede/execução: ${errorMessage}`);
      console.log(`[${nowIso()}] Aguardando 60 segundos antes da próxima tentativa.`);
      await wait(ERROR_RETRY_INTERVAL_MS);
    }
  }
}

async function bootstrap() {
  if (SELF_TEST_MODE) {
    await runSelfTest();
    return;
  }

  if (CHECK_ONCE_MODE) {
    await runSingleCheck();
    return;
  }

  await monitorLoop();
}

bootstrap().catch((error) => {
  console.error(`[${nowIso()}] Erro fatal: ${error?.message || 'Erro desconhecido'}`);
  process.exit(1);
});
