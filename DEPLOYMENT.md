# Guía de Despliegue en Servidor Linux

## Problema común: Falta de dependencias de Chromium

Si recibes el error:
```
libatk-1.0.so.0: cannot open shared object file: No such file or directory
```

Esto significa que faltan las dependencias del sistema para ejecutar Chromium.

## Solución

### Opción 1: Usar el script automático

En tu servidor Linux, ejecuta:

```bash
sudo bash install-dependencies.sh
```

### Opción 2: Instalación manual por distribución

#### Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6
```

#### CentOS/RHEL:

```bash
sudo yum install -y \
    alsa-lib \
    atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXdamage \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango
```

#### Alpine Linux (contenedores Docker):

```bash
apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
```

### Opción 3: Instalar Chrome completo

En algunos servidores es más fácil instalar Chrome completo:

```bash
# Descargar e instalar Google Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt-get install -f -y
```

El bot detectará automáticamente Chrome instalado y lo usará.

## Dockerfile (Recomendado para producción)

Si usas Docker, aquí tienes un Dockerfile optimizado:

```dockerfile
FROM node:18-slim

# Instalar dependencias de Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 4242

CMD ["npm", "start"]
```

## Variables de entorno necesarias

Asegúrate de tener configurado tu `.env`:

```env
DEEPSEEK_API_KEY=tu_api_key_aqui
WEB_PORT=4242

# Configuración de base de datos
DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=whatsapp_bot
```

## Verificación

Después de instalar las dependencias, verifica que todo funciona:

```bash
npm start
```

Deberías ver:
```
Iniciando bot de WhatsApp con whatsapp-web.js...
Usando Chromium bundled de Puppeteer
Escanea este código QR con WhatsApp:
[QR Code aparece aquí]
```

## Problemas comunes

1. **Error de permisos**: Asegúrate de que el usuario tiene permisos para escribir en `.wwebjs_auth/`
2. **Memoria insuficiente**: Chrome requiere al menos 512MB de RAM disponible
3. **Puerto ocupado**: Verifica que el puerto 4242 esté disponible con `lsof -i:4242`

## Soporte

Si tienes problemas, revisa los logs en `logs/` o contacta al equipo de desarrollo.
