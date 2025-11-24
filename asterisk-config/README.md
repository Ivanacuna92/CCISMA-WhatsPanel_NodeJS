# Configuración de Asterisk para Voicebot Navetec

Esta carpeta contiene los archivos de configuración de Asterisk listos para usar.

## Credenciales del Trunk
- **IP:** 78.13.36.30
- **Puerto SIP:** 5060
- **Puertos RTP:** 10000:40000
- **Códecs:** alaw, g729
- **Formato de marcación:** 96307 + 10 dígitos
- **Sin autenticación** (trunk IP-based)

## Instrucciones de Instalación

### 1. Instalar Asterisk (si no lo tienes)
```bash
# Ver guía completa en: ../ASTERISK_SETUP.md
# Resumen rápido para Ubuntu:
sudo apt update
sudo apt install asterisk asterisk-core-sounds-es -y
```

### 2. Respaldar Configuración Actual
```bash
sudo cp /etc/asterisk/pjsip.conf /etc/asterisk/pjsip.conf.backup
sudo cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.backup
sudo cp /etc/asterisk/manager.conf /etc/asterisk/manager.conf.backup
sudo cp /etc/asterisk/rtp.conf /etc/asterisk/rtp.conf.backup
```

### 3. Copiar Archivos de Configuración
```bash
# Desde la raíz del proyecto
sudo cp asterisk-config/pjsip.conf /etc/asterisk/pjsip.conf
sudo cp asterisk-config/extensions.conf /etc/asterisk/extensions.conf
sudo cp asterisk-config/manager.conf /etc/asterisk/manager.conf
sudo cp asterisk-config/rtp.conf /etc/asterisk/rtp.conf
```

### 4. Editar pjsip.conf (IMPORTANTE)
```bash
sudo nano /etc/asterisk/pjsip.conf
```
Busca las líneas con `YOUR_PUBLIC_IP` y reemplázalas con tu IP pública real:
```ini
external_media_address=TU_IP_PUBLICA
external_signaling_address=TU_IP_PUBLICA
```

Para saber tu IP pública:
```bash
curl ifconfig.me
```

### 5. Configurar Firewall
```bash
# Permitir puertos SIP y RTP
sudo ufw allow 5060/udp
sudo ufw allow 10000:40000/udp
sudo ufw allow 5038/tcp  # AMI
sudo ufw reload
```

### 6. Ajustar Permisos
```bash
sudo chown asterisk:asterisk /etc/asterisk/*.conf
sudo chmod 640 /etc/asterisk/manager.conf  # Manager.conf tiene credenciales
```

### 7. Recargar Asterisk
```bash
sudo systemctl restart asterisk

# Verificar que inició correctamente
sudo systemctl status asterisk
```

### 8. Verificar Configuración
```bash
# Conectar a consola de Asterisk
sudo asterisk -rvvv

# Dentro de la consola, ejecutar:
pjsip show endpoints
pjsip show aors
manager show users
rtp show settings

# Deberías ver:
# - trunk-navetec como endpoint
# - voicebot como usuario de AMI
# - RTP en rango 10000-40000
```

### 9. Prueba de Trunk
```bash
# Desde la consola de Asterisk (sudo asterisk -rvvv):
channel originate PJSIP/963075512345678@trunk-navetec application Playback demo-congrats

# Reemplaza 5512345678 con un número real de prueba
# Deberías escuchar un mensaje de felicitaciones
```

### 10. Prueba de AMI
```bash
# Probar conexión AMI
telnet 127.0.0.1 5038

# Autenticarte:
Action: Login
Username: voicebot
Secret: Voicebot2025!Navetec#Secure

# Deberías recibir:
# Response: Success
```

## Troubleshooting

### Error: "No route to host"
- Verifica que la IP del trunk sea accesible: `ping 78.13.36.30`
- Revisa firewall

### Error: "Failed to authenticate"
- Verifica credenciales en manager.conf
- Verifica que coincidan con .env

### Error: "No compatible codecs"
- Asegúrate que alaw y g729 estén instalados:
  ```bash
  sudo asterisk -rx "core show codecs"
  ```

### Ver logs en tiempo real
```bash
sudo tail -f /var/log/asterisk/full
```

## Notas Importantes

1. **El trunk NO requiere registro** (autenticación por IP)
2. **Siempre marca con prefijo 96307**
3. **Formato:** 96307 + 10 dígitos (ej: 963075512345678)
4. **CallerID:** Ajusta `TRUNK_CALLER_ID` en .env con tu número real
5. **Seguridad:** AMI solo escucha en localhost (127.0.0.1)

## Siguiente Paso

Una vez Asterisk esté funcionando y probado:
- Instalar dependencias NPM del voicebot
- Iniciar servicios de Node.js
- Probar integración completa

¿Dudas? Revisa el log de Asterisk: `/var/log/asterisk/full`
