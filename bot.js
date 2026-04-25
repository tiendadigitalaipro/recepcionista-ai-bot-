/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  RECEPCIONISTA AI — WhatsApp Bot                     ║
 * ║  A2K Digital Studio                                  ║
 * ║  Baileys (WhatsApp) + Hugging Face AI                ║
 * ╚══════════════════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const OpenAI  = require('openai');
const qrcode  = require('qrcode-terminal');
const QRCode  = require('qrcode');
const express = require('express');
const fs      = require('fs');
const pino    = require('pino');

// ── SERVIDOR QR (para Railway) ───────────────────────────
const PORT = process.env.PORT || 3000;
let qrActual = null;
let botConectado = false;

const webApp = express();
webApp.get('/qr', async (req, res) => {
    if (botConectado) {
        return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#00ff88"><h2>✅ WhatsApp ya está conectado</h2><p>El bot está activo y funcionando.</p></body></html>');
    }
    if (!qrActual) {
        return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff"><h2>⏳ Generando QR...</h2><p>Espera unos segundos y recarga la página.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
    }
    const imgData = await QRCode.toDataURL(qrActual, { width: 300, margin: 2 });
    res.send(`<html><head><meta http-equiv="refresh" content="30"></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff"><h2 style="color:#00ff88">📱 Recepcionista AI — Escanea el QR</h2><p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p><img src="${imgData}" style="border:4px solid #00ff88;border-radius:12px;margin:20px 0"><p style="color:#aaa;font-size:13px">Se recarga automáticamente cada 30s · <a href="/qr" style="color:#00ff88">Recargar ahora</a></p></body></html>`);
});
webApp.get('/', (req, res) => res.redirect('/qr'));
webApp.listen(PORT, () => console.log(`🌐 Servidor QR activo → puerto ${PORT} → visita /qr`));

// ── CONFIG ──────────────────────────────────────────────
const HF_TOKEN    = process.env.HF_TOKEN;
const HF_MODEL    = process.env.HF_MODEL    || 'Qwen/Qwen2.5-72B-Instruct';
const PROFILE_FILE = process.env.PROFILE_FILE || './perfil_negocio.json';
const OWNER_PHONE  = process.env.OWNER_PHONE  || '17865056242';

// ── HF CLIENT (OpenAI-compatible) ───────────────────────
const ai = new OpenAI({
    baseURL: 'https://router.huggingface.co/v1',
    apiKey:  HF_TOKEN,
});

// ── HISTORIAL POR NÚMERO ─────────────────────────────────
const chats  = new Map();
const MAX_HIST = 10;

function perfil() {
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
}

function systemPrompt(p) {
    const precios   = Object.entries(p.precios || {}).map(([k,v]) => `• ${k}: ${v}`).join('\n');
    const servicios = (p.servicios || []).join(', ');
    return `Eres ${p.nombre_bot || 'Valeria'}, la recepcionista virtual de ${p.nombre}.
Eres amigable, profesional y muy concisa (máximo 4 líneas por respuesta).
Detecta el idioma del cliente y responde en ese idioma (español o inglés).

DATOS DEL NEGOCIO:
• Nombre: ${p.nombre}
• Tipo: ${p.tipo}
• Horario: ${p.horario}
• Dirección: ${p.direccion || 'Preguntar en este chat'}
• Teléfono: ${p.telefono || 'Preguntar en este chat'}
• Reservas: ${p.booking_link || 'Escríbenos para reservar'}
• Servicios: ${servicios}

PRECIOS:
${precios}

INFO EXTRA:
${p.info_extra || ''}

REGLAS IMPORTANTES:
1. Para citas → da link de booking o teléfono directo.
2. Si el cliente quiere hablar con humano → "te conecto con nuestro equipo en un momento".
3. Si no tienes la info → no inventes, da el teléfono.
4. Máximo 1-2 emojis por mensaje.
5. Solo saluda en el primer mensaje de la conversación.
6. Respuestas cortas y directas siempre.`;
}

function necesitaHumano(texto) {
    const palabras = [
        'hablar con alguien','hablar con una persona','quiero hablar con','necesito hablar',
        'speak to someone','talk to a person','speak with a human',
        'humano','human','urgente','urgent','emergencia','emergency',
        'no me ayuda','enójado','molesto','reclamo','queja'
    ];
    return palabras.some(p => texto.toLowerCase().includes(p));
}

async function responderIA(numero, texto) {
    const p = perfil();

    if (!chats.has(numero)) chats.set(numero, []);
    const hist = chats.get(numero);

    try {
        const messages = [
            { role: 'system', content: systemPrompt(p) },
            ...hist.slice(-MAX_HIST),
            { role: 'user', content: texto }
        ];

        const res = await ai.chat.completions.create({
            model:       HF_MODEL,
            messages,
            max_tokens:  200,
            temperature: 0.7,
        });

        const respuesta = res.choices[0].message.content.trim();

        hist.push({ role: 'user',      content: texto });
        hist.push({ role: 'assistant', content: respuesta });
        if (hist.length > MAX_HIST * 2) chats.set(numero, hist.slice(-MAX_HIST));

        return respuesta;
    } catch (err) {
        console.error('❌ AI error:', err.message || err);
        return `Disculpa, tuve un problema técnico. Por favor contáctanos al ${p.telefono || 'nuestra línea'} 📞`;
    }
}

// ── BOT PRINCIPAL ────────────────────────────────────────
async function iniciarBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session');

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Recepcionista AI', 'Chrome', '1.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrActual = qr;
            botConectado = false;
            console.log('\n📱 QR listo — abre /qr en el navegador para escanearlo\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            qrActual = null;
            botConectado = true;
            console.log('\n✅ WhatsApp conectado! Recepcionista AI activa.\n');
        }
        if (connection === 'close') {
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconectando...');
                iniciarBot();
            } else {
                console.log('❌ Sesión cerrada. Borra la carpeta auth_session y vuelve a ejecutar.');
                process.exit(0);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const texto = msg.message.conversation
                       || msg.message.extendedTextMessage?.text
                       || '';
            if (!texto.trim()) continue;

            const numero = msg.key.remoteJid.replace('@s.whatsapp.net', '');
            console.log(`📩 [+${numero}]: ${texto}`);

            const respuesta = await responderIA(numero, texto);
            console.log(`🤖 Bot: ${respuesta}\n`);

            await sock.sendMessage(msg.key.remoteJid, { text: respuesta });

            if (necesitaHumano(texto) && OWNER_PHONE) {
                await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
                    text: `⚠️ *Cliente necesita atención humana*\n📱 +${numero}\n💬 "${texto}"`
                });
            }
        }
    });
}

console.log('╔════════════════════════════════════╗');
console.log('║  RECEPCIONISTA AI — WhatsApp Bot   ║');
console.log('║  A2K Digital Studio                ║');
console.log('╚════════════════════════════════════╝\n');
console.log('📱 Iniciando conexión WhatsApp...');
console.log('   (Escanea el QR con el WhatsApp del negocio)\n');

iniciarBot().catch(console.error);
