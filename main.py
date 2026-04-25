"""
╔══════════════════════════════════════════════════════════╗
║  RECEPCIONISTA AI — Bot de WhatsApp                      ║
║  A2K Digital Studio                                      ║
║  Stack: FastAPI + Green API + Google Gemini              ║
╚══════════════════════════════════════════════════════════╝
"""
import json
import os
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import requests
from openai import OpenAI

app = FastAPI()

# ── CONFIG ───────────────────────────────────────────────
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
GREEN_API_ID    = os.getenv("GREEN_API_ID", "")
GREEN_API_TOKEN = os.getenv("GREEN_API_TOKEN", "")
OWNER_PHONE     = os.getenv("OWNER_PHONE", "")
PROFILE_FILE    = os.getenv("PROFILE_FILE", "perfil_negocio.json")

# ── GEMINI vía OpenAI-compatible API ─────────────────────
ai = OpenAI(
    api_key=GEMINI_API_KEY,
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

# ── MEMORIA DE CONVERSACIONES (en memoria, 24h implícito) ─
conversaciones = defaultdict(list)
MAX_HISTORIAL = 12


def cargar_perfil():
    with open(PROFILE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def prompt_sistema(perfil):
    precios_txt = "\n".join(f"  • {k}: {v}" for k, v in perfil.get("precios", {}).items())
    servicios_txt = ", ".join(perfil.get("servicios", []))
    return f"""Eres {perfil.get('nombre_bot', 'Valeria')}, la recepcionista virtual de {perfil['nombre']}.
Eres amigable, profesional y respondes de forma concisa (máximo 4 líneas por mensaje).
Respondes en el idioma del cliente (español o inglés).

📍 NEGOCIO:
- Nombre: {perfil['nombre']}
- Tipo: {perfil['tipo']}
- Horario: {perfil['horario']}
- Dirección: {perfil.get('direccion', 'Consultar por este chat')}
- Teléfono: {perfil.get('telefono', 'Consultar por este chat')}
- Link de reservas: {perfil.get('booking_link', 'Escríbenos para reservar')}

💅 SERVICIOS:
{servicios_txt}

💰 PRECIOS:
{precios_txt}

ℹ️ INFO EXTRA:
{perfil.get('info_extra', '')}

📌 REGLAS:
1. Para citas/reservas → da el link de booking o teléfono.
2. Si pide hablar con humano o está frustrado → di "te conecto con nuestro equipo ahora mismo".
3. Nunca inventes info. Si no sabes → "te puedo ayudar con más detalles por teléfono".
4. Usa 1-2 emojis por mensaje máximo.
5. No saludes en cada mensaje, solo en el primero.
"""


def enviar_whatsapp(numero, texto):
    url = f"https://api.green-api.com/waInstance{GREEN_API_ID}/sendMessage/{GREEN_API_TOKEN}"
    try:
        requests.post(url, json={"chatId": f"{numero}@c.us", "message": texto}, timeout=10)
    except Exception as e:
        print(f"Error enviando a {numero}: {e}")


def necesita_escalacion(texto):
    frases = [
        "hablar con alguien", "hablar con una persona", "quiero hablar con",
        "speak to someone", "speak with someone", "talk to a person",
        "humano", "human", "urgente", "urgent", "emergencia", "emergency",
        "no me ayuda", "no entiendes", "you don't understand"
    ]
    return any(f in texto.lower() for f in frases)


def procesar_mensaje(numero, texto):
    perfil = cargar_perfil()
    historial = conversaciones[numero]

    if len(historial) > MAX_HISTORIAL:
        historial = historial[-MAX_HISTORIAL:]

    try:
        messages = [{"role": "system", "content": prompt_sistema(perfil)}]
        for h in historial[-MAX_HISTORIAL:]:
            messages.append({"role": h["role"], "content": h["parts"][0]})
        messages.append({"role": "user", "content": texto})

        res = ai.chat.completions.create(
            model="gemini-1.5-flash",
            messages=messages,
            max_tokens=200,
        )
        texto_respuesta = res.choices[0].message.content.strip()

        historial.append({"role": "user",      "parts": [texto]})
        historial.append({"role": "assistant",  "parts": [texto_respuesta]})
        conversaciones[numero] = historial

        if necesita_escalacion(texto) and OWNER_PHONE:
            enviar_whatsapp(
                OWNER_PHONE,
                f"⚠️ *Cliente necesita atención humana*\n📱 Número: +{numero}\n💬 Mensaje: \"{texto}\""
            )

        return texto_respuesta

    except Exception as e:
        print(f"Error Gemini: {e}")
        return "Lo siento, estoy teniendo problemas técnicos. Por favor llama al " + perfil.get("telefono", "nuestra línea directa") + " 📞"


# ── WEBHOOK GREEN API ────────────────────────────────────
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        tipo = data.get("typeWebhook", "")

        if tipo != "incomingMessageReceived":
            return JSONResponse({"ok": True})

        msg_data = data.get("messageData", {})
        if msg_data.get("typeMessage") != "textMessage":
            return JSONResponse({"ok": True})

        numero  = data["senderData"]["sender"].replace("@c.us", "")
        texto   = msg_data["textMessageData"]["textMessage"].strip()

        if not texto:
            return JSONResponse({"ok": True})

        print(f"📩 [{numero}]: {texto}")
        respuesta = procesar_mensaje(numero, texto)
        print(f"🤖 Bot: {respuesta}")
        enviar_whatsapp(numero, respuesta)

    except Exception as e:
        print(f"Error webhook: {e}")

    return JSONResponse({"ok": True})


@app.get("/")
def health():
    return {"status": "ok", "producto": "Recepcionista AI", "version": "1.0", "by": "A2K Digital Studio"}
