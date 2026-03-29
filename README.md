# 🤖 Ana — Secretaria Virtual IA · Consultorio Médico
**Retell AI + Twilio + Google Calendar | Español Dominicano**

---

## ¿Qué hace Ana?

- ✅ **Contesta llamadas** entrantes del consultorio
- ✅ **Agenda, confirma, reprograma y cancela citas** sincronizando con Google Calendar en tiempo real
- ✅ **Llama a los pacientes** 24h antes para confirmar (outbound automático)
- ✅ **Maneja emergencias** y transfiere al doctor
- ✅ Habla en **español dominicano natural** — no suena a robot

---

## 🗂️ Estructura del proyecto

```
ana-agent/
├── src/
│   ├── server.js           # Servidor Express — todos los endpoints
│   └── calendar.js         # Google Calendar: agendar/buscar/cancelar
├── tools/
│   └── retell-tools.js     # Schemas de tools para Retell AI
├── prompts/
│   └── system-prompt.js    # System prompt de Ana (completo y corto)
├── scripts/
│   ├── setup-retell.js     # Crea el agente en Retell via API
│   ├── setup-twilio.js     # Guía + config de Twilio
│   └── cron-confirmations.js  # Cron de confirmaciones diarias
├── .env.example            # Variables de entorno — copia como .env
├── railway.toml            # Deploy en Railway.app
└── Procfile                # Deploy en Render/Heroku
```

---

## 🚀 GUÍA COMPLETA PASO A PASO

### PASO 1 — Crear cuentas (20 minutos)

**Retell AI:**
1. https://retell.ai → Sign Up
2. Dashboard → API Keys → copia tu API Key
3. Guarda: `RETELL_API_KEY=key_xxx`

**Twilio:**
1. https://twilio.com/try-twilio → Sign Up
2. Verifica email y teléfono
3. Anota: Account SID y Auth Token del Dashboard
4. Comprar número: Phone Numbers → Buy → Dominican Republic (+1-809/829/849) → Voice → Buy ($1.15/mes)

**Google Cloud (para Calendar API):**
1. https://console.cloud.google.com → Nuevo proyecto "Ana Agent"
2. APIs & Services → Library → "Google Calendar API" → Enable
3. Credentials → Create → OAuth 2.0 Client ID → Web Application
4. Authorized redirect URI: `https://tu-dominio.com/auth/google/callback`
5. Anota: Client ID y Client Secret

---

### PASO 2 — Servidor (15 minutos)

```bash
# Copiar variables de entorno
cp .env.example .env
# Editar .env con todos tus valores reales

# Instalar dependencias
npm install

# Deploy en Railway (gratis)
npm install -g @railway/cli
railway login
railway init
railway up
# Anota tu URL: https://ana-agent-xxx.up.railway.app
```

**Autorizar Google Calendar** (una sola vez):
```
Visita: https://tu-dominio.com/auth/google
Autoriza → copia el refresh_token → agrégalo al .env
Redeploy: railway up
```

---

### PASO 3 — Crear agente en Retell (10 minutos)

```bash
# Automático (recomendado)
BACKEND_URL=https://tu-dominio.com node scripts/setup-retell.js

# Anota el Agent ID que aparece y agrégalo al .env:
# RETELL_AGENT_ID=agent_xxxxxxxx
```

**Manual (si prefieres el Dashboard):**
1. retell.ai → Agents → + Create Agent
2. Name: "Ana — Secretaria Consultorio"
3. LLM: GPT-4o
4. System Prompt: resultado de `npm run config`
5. Voice: busca "Ramona" (es-DO) o "Valentina"
6. Language: Spanish (Latin America)
7. Agrega cada tool de `tools/retell-tools.js` apuntando a `https://tu-dominio.com/tools/...`
8. Webhook: `https://tu-dominio.com/webhook/retell`
9. Interruption Sensitivity: 0.9 | Backchannel: ✅

---

### PASO 4 — Conectar Twilio con Retell (15 minutos)

1. retell.ai → Phone Numbers → + Add → **"Import from Twilio"**
2. Ingresa: Account SID + Auth Token
3. Selecciona tu número
4. Asigna el agente: **Ana — Secretaria Consultorio**
5. Retell configura automáticamente el webhook en Twilio

**Para outbound (KYC):**
1. retell.ai → Settings → Compliance
2. Completa verificación de identidad
3. Agrega tu número de Twilio como Caller ID verificado
4. Espera aprobación 24–48h

---

### PASO 5 — Confirmaciones automáticas (5 minutos)

Agrega un cron job en Railway → Settings → Cron:
```
0 9 * * *    node scripts/cron-confirmations.js
```
Ejecuta todos los días a las 9 AM — llama a todos los pacientes del día siguiente.

---

### PASO 6 — Forwarding del número del consultorio

**Desde celular Claro RD:** marca `*21*+18291234567#` (tu número de Twilio)
**Desde celular Altice/Viva:** llama a atención al cliente y pide call forwarding al número de Twilio.
**Desde sistema VoIP existente:** Panel de admin → Call Routing → redirigir a tu número Twilio.

---

## 🧪 SCRIPT DE PRUEBAS

**Prueba 1 — Cita nueva:**
- Llama al número → di "quiero hacer una cita para revisión"
- Ana pide motivo, verifica disponibilidad, propone horario, pide nombre y teléfono, crea la cita
- Verifica que el evento aparezca en Google Calendar ✅

**Prueba 2 — Confirmar cita:**
- "Llamo para confirmar mi cita" → da tu nombre → Ana la confirma
- El status del evento en Calendar cambia a "confirmed" ✅

**Prueba 3 — Emergencia:**
- "Tengo un dolor muy fuerte en el pecho"
- Ana menciona el 911 y transfiere al doctor ✅

**Prueba 4 — Outbound manual:**
```bash
curl -X POST https://tu-dominio.com/outbound/confirm-appointment \
  -H "Content-Type: application/json" \
  -d '{"patient_name":"María García","patient_phone":"+18091234567","appointment_label":"mañana a las 10 AM","event_id":"abc123"}'
```
Tu teléfono recibe llamada de Ana ✅

---

## 💰 COSTOS MENSUALES ESTIMADOS

| Servicio | Costo |
|----------|-------|
| Retell AI ~150 min | ~$15–45 USD |
| Twilio número virtual | ~$1.15 USD |
| Twilio minutos inbound | ~$0.0085/min |
| Google Calendar API | Gratis |
| Railway / Render | Gratis (plan hobby) |
| **TOTAL ESTIMADO** | **~$20–50 USD/mes** |

---

## 🔧 COMANDOS ÚTILES

```bash
npm run config          # Ver system prompt completo
npm run tools           # Ver tools en JSON
npm run setup:retell    # Crear agente en Retell
npm run cron:confirm    # Disparar confirmaciones ahora
npm run dev             # Servidor local con hot-reload
npm start               # Producción
```

---

## 🔄 CLONAR PARA OTRO NICHO

1. Cambia en `.env`: `DOCTOR_NAME`, `DOCTOR_SPECIALTY`, `CLINIC_NAME`
2. Ajusta `prompts/system-prompt.js` para el nuevo contexto (odontología, psicología, etc.)
3. Corre: `npm run setup:retell` → nuevo agente en minutos
4. Costo adicional de código: $0

---

**Retell AI Docs:** https://docs.retellai.com  
**Twilio Docs:** https://www.twilio.com/docs  
**Google Calendar API:** https://developers.google.com/calendar/api
