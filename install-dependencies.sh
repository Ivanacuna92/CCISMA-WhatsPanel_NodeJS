#!/bin/bash

# Script para instalar dependencias de Chromium/Puppeteer en Linux

echo "Instalando dependencias de Chromium para whatsapp-web.js..."

# Detectar el sistema operativo
if [ -f /etc/debian_version ]; then
    echo "Sistema Debian/Ubuntu detectado"
    apt-get update
    apt-get install -y \
        ca-certificates \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgbm1 \
        libgcc1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libstdc++6 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        lsb-release \
        wget \
        xdg-utils

    echo "Dependencias instaladas exitosamente en Debian/Ubuntu"

elif [ -f /etc/redhat-release ]; then
    echo "Sistema RedHat/CentOS/Fedora detectado"
    yum install -y \
        alsa-lib \
        atk \
        cups-libs \
        gtk3 \
        libXcomposite \
        libXcursor \
        libXdamage \
        libXext \
        libXi \
        libXrandr \
        libXScrnSaver \
        libXtst \
        pango \
        xorg-x11-fonts-100dpi \
        xorg-x11-fonts-75dpi \
        xorg-x11-fonts-cyrillic \
        xorg-x11-fonts-misc \
        xorg-x11-fonts-Type1 \
        xorg-x11-utils

    echo "Dependencias instaladas exitosamente en RedHat/CentOS/Fedora"

elif [ -f /etc/alpine-release ]; then
    echo "Sistema Alpine Linux detectado"
    apk add --no-cache \
        chromium \
        nss \
        freetype \
        harfbuzz \
        ca-certificates \
        ttf-freefont

    echo "Dependencias instaladas exitosamente en Alpine Linux"

else
    echo "Sistema operativo no detectado automáticamente"
    echo "Por favor instala manualmente las dependencias de Chromium"
    exit 1
fi

echo ""
echo "¡Instalación completada!"
echo "Ahora puedes iniciar el bot con: npm start"
