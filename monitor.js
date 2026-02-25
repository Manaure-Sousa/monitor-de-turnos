const axios = require('axios');
const nodemailer = require('nodemailer');

const CHECK_INTERVAL_MS = 30_000;
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

const {
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_TO,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID
} = process.env;

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

      await wait(CHECK_INTERVAL_MS);
    } catch (error) {
      const errorMessage = error?.message || 'Erro desconhecido';
      console.error(`[${nowIso()}] Erro de rede/execução: ${errorMessage}`);
      console.log(`[${nowIso()}] Aguardando 60 segundos antes da próxima tentativa.`);
      await wait(ERROR_RETRY_INTERVAL_MS);
    }
  }
}

monitorLoop().catch((error) => {
  console.error(`[${nowIso()}] Erro fatal: ${error?.message || 'Erro desconhecido'}`);
  process.exit(1);
});
