# Instalación y Configuración de Asterisk para Voicebot

## ¿Por qué es necesario Asterisk?

**Asterisk es absolutamente necesario** porque:
- Es el **PBX (Central Telefónica)** que hace las llamadas reales
- Se conecta a tu **trunk SIP** (78.13.36.30) para sacar llamadas
- Maneja el **audio bidireccional** entre el cliente y el sistema
- Node.js **NO hace llamadas**, solo controla Asterisk via AMI/AGI

**Flujo:** Node.js → Asterisk → Trunk SIP → Red Telefónica → Cliente

---

## 1. Instalación de Asterisk

### Opción A: Ubuntu/Debian (Recomendado)

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar dependencias
sudo apt install -y build-essential wget libssl-dev libncurses5-dev \
    libnewt-dev libxml2-dev linux-headers-$(uname -r) libsqlite3-dev \
    uuid-dev libjansson-dev

# Descargar Asterisk 20 (LTS)
cd /usr/src
sudo wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
sudo tar -xvzf asterisk-20-current.tar.gz
cd asterisk-20*/

# Instalar prerequisitos
sudo contrib/scripts/install_prereq install

# Configurar con los módulos necesarios
sudo ./configure --with-jansson-bundled

# Seleccionar módulos (opcional, puedes usar los por defecto)
sudo make menuselect
# En el menú, asegúrate de seleccionar:
# - Resource Modules → res_agi (para AGI)
# - Channel Drivers → chan_sip o chan_pjsip (para trunk SIP)

# Compilar e instalar (toma ~15-30 minutos)
sudo make -j$(nproc)
sudo make install
sudo make samples  # Instala archivos de configuración de ejemplo
sudo make config   # Configura Asterisk como servicio
```

### Opción B: CentOS/Rocky Linux

```bash
# Instalar repositorio EPEL
sudo dnf install -y epel-release

# Instalar dependencias
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y wget ncurses-devel libxml2-devel sqlite-devel \
    libuuid-devel jansson-devel openssl-devel

# Seguir los mismos pasos de descarga y compilación que Ubuntu
```

### Verificar instalación

```bash
# Ver versión
asterisk -V

# Iniciar Asterisk
sudo systemctl start asterisk
sudo systemctl enable asterisk

# Verificar estado
sudo systemctl status asterisk

# Conectar a la consola de Asterisk
sudo asterisk -rvvv
```

---

## 2. Configuración del Trunk SIP

Edita `/etc/asterisk/pjsip.conf` (o `sip.conf` si usas chan_sip):

```ini
; ============================================
; TRUNK SIP PARA LLAMADAS SALIENTES
; ============================================

[trunk-saliente]
type=endpoint
context=from-trunk
disallow=all
allow=ulaw
allow=alaw
allow=g729
aors=trunk-saliente
outbound_auth=trunk-saliente-auth
from_user=your_trunk_username
from_domain=78.13.36.30

[trunk-saliente]
type=aor
contact=sip:78.13.36.30:5060

[trunk-saliente-auth]
type=auth
auth_type=userpass
username=YOUR_TRUNK_USERNAME
password=YOUR_TRUNK_PASSWORD

[trunk-saliente]
type=identify
endpoint=trunk-saliente
match=78.13.36.30
```

**IMPORTANTE:** Reemplaza `YOUR_TRUNK_USERNAME` y `YOUR_TRUNK_PASSWORD` con las credenciales de tu trunk.

---

## 3. Configuración del Dialplan

Edita `/etc/asterisk/extensions.conf`:

```ini
; ============================================
; DIALPLAN PARA VOICEBOT
; ============================================

[general]
static=yes
writeprotect=no
clearglobalvars=no

; Contexto para llamadas salientes del voicebot
[voicebot-outbound]
exten => _X.,1,NoOp(=== VOICEBOT: Llamada saliente a ${EXTEN} ===)
 same => n,Set(CHANNEL(language)=es)
 same => n,Set(CALLERID(name)=Navetec)
 same => n,Set(CALLERID(num)=5212345678)  ; Reemplazar con tu número
 same => n,Dial(PJSIP/${EXTEN}@trunk-saliente,60,rtT)
 same => n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?answered:noanswer)
 same => n(answered),AGI(agi://127.0.0.1:4573)  ; Conecta con Node.js AGI
 same => n,Hangup()
 same => n(noanswer),NoOp(=== No contestaron: ${DIALSTATUS} ===)
 same => n,Hangup()

; Contexto para llamadas entrantes del trunk (si las hay)
[from-trunk]
exten => _X.,1,NoOp(=== Llamada entrante de ${CALLERID(num)} ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Hangup()
```

---

## 4. Habilitar AMI (Asterisk Manager Interface)

Edita `/etc/asterisk/manager.conf`:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[voicebot]
secret = VoicebotSecretPassword123!
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
read = all
write = all
```

**IMPORTANTE:** Cambia `VoicebotSecretPassword123!` por una contraseña segura.

---

## 5. Habilitar AGI/FastAGI

No requiere configuración especial, solo asegúrate que el módulo esté cargado:

```bash
sudo asterisk -rx "module show like agi"
# Debe aparecer: res_agi.so
```

---

## 6. Aplicar Configuración

```bash
# Recargar configuración de Asterisk
sudo asterisk -rx "core reload"

# O reiniciar Asterisk completamente
sudo systemctl restart asterisk

# Verificar trunk SIP
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "pjsip show aors"

# Verificar que AMI está escuchando
sudo netstat -tlnp | grep 5038
```

---

## 7. Configuración del Firewall

```bash
# Permitir puertos necesarios
sudo ufw allow 5038/tcp  # AMI
sudo ufw allow 4573/tcp  # AGI (puerto que usará Node.js)
sudo ufw allow 5060/udp  # SIP
sudo ufw allow 10000:20000/udp  # RTP (audio)

# Aplicar reglas
sudo ufw reload
```

---

## 8. Variables de Entorno (.env)

Agrega al archivo `.env`:

```bash
# ===== ASTERISK CONFIGURATION =====
ASTERISK_HOST=127.0.0.1
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USERNAME=voicebot
ASTERISK_AMI_PASSWORD=VoicebotSecretPassword123!
ASTERISK_AGI_PORT=4573

# ===== TRUNK CONFIGURATION =====
TRUNK_IP=78.13.36.30
TRUNK_CONTEXT=voicebot-outbound
TRUNK_CALLER_ID=5212345678

# ===== OPENAI VOICE CONFIGURATION =====
OPENAI_API_KEY=tu_api_key_de_openai_aqui
OPENAI_TTS_VOICE=nova
OPENAI_WHISPER_LANGUAGE=es
OPENAI_GPT_MODEL=gpt-4o

# ===== VOICEBOT CONFIGURATION =====
VOICEBOT_MAX_CALL_DURATION=300
VOICEBOT_MAX_RETRIES=3
VOICEBOT_CONCURRENT_CALLS=2
VOICEBOT_RECORDING_PATH=/var/lib/asterisk/sounds/recordings
```

---

## 9. Testing

### Test 1: Verificar conexión AMI desde terminal

```bash
telnet 127.0.0.1 5038
# Deberías ver:
# Asterisk Call Manager/X.X.X

# Autenticarte:
Action: Login
Username: voicebot
Secret: VoicebotSecretPassword123!

# Deberías recibir "Response: Success"
```

### Test 2: Hacer llamada de prueba desde Asterisk

```bash
sudo asterisk -rx "channel originate PJSIP/+5215512345678@trunk-saliente application Playback demo-congrats"
```

---

## 10. Solución de Problemas

### Ver logs en tiempo real
```bash
sudo tail -f /var/log/asterisk/full
```

### Ver estado de canales activos
```bash
sudo asterisk -rx "core show channels"
```

### Verificar registro del trunk
```bash
sudo asterisk -rx "pjsip show registrations"
```

### Reiniciar Asterisk completamente
```bash
sudo systemctl restart asterisk
```

---

## 11. Arquitectura Final

```
┌─────────────────┐
│   Node.js App   │
│  (Voicebot)     │
└────────┬────────┘
         │
         │ AMI (Control)
         │ AGI (Audio Processing)
         │
┌────────▼────────┐
│    Asterisk     │
│      PBX        │
└────────┬────────┘
         │
         │ SIP Trunk
         │
┌────────▼────────┐
│  78.13.36.30    │
│  (Trunk SIP)    │
└────────┬────────┘
         │
         │ Red Telefónica
         │
┌────────▼────────┐
│    Cliente      │
│   (Teléfono)    │
└─────────────────┘
```

---

## Notas Importantes

1. **Asterisk debe estar en el mismo servidor que Node.js** (o tener conectividad directa)
2. La **trunk debe estar configurada y funcionando** antes de empezar con el voicebot
3. Necesitas **credenciales válidas** de tu proveedor SIP (trunk)
4. El **audio RTP** requiere puertos UDP abiertos (10000-20000)
5. **Prueba primero** hacer llamadas manuales desde Asterisk antes de integrar con Node.js

---

## ¿Siguiente Paso?

Una vez Asterisk esté instalado y configurado:
1. Ejecuta el SQL en phpMyAdmin
2. Instala las dependencias NPM del voicebot
3. Implementa los servicios de Node.js

¿Necesitas ayuda con algún paso específico?
