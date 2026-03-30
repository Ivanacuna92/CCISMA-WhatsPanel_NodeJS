const ariClient = require('ari-client');
const EventEmitter = require('events');
require('dotenv').config();

class ARIManager extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.connected = false;
        this.activeCalls = new Map(); // Map de llamadas activas
        this.pendingCalls = new Map(); // Map de channelId -> phoneNumber para llamadas en progreso
    }

    async connect() {
        try {
            console.log('🔌 Conectando a Asterisk ARI...');

            this.client = await ariClient.connect(
                process.env.ASTERISK_ARI_URL || 'http://localhost:8089',
                process.env.ASTERISK_ARI_USERNAME || 'voicebot',
                process.env.ASTERISK_ARI_PASSWORD || 'VoicebotARI2024!'
            );

            this.connected = true;
            console.log('✅ Conectado a Asterisk ARI');

            // Iniciar la aplicación Stasis
            this.client.start('voicebot');

            // Escuchar eventos de Stasis
            this.client.on('StasisStart', (event, channel) => {
                this.handleStasisStart(event, channel);
            });

            this.client.on('StasisEnd', (event, channel) => {
                this.handleStasisEnd(event, channel);
            });

            this.client.on('ChannelDestroyed', (event, channel) => {
                console.log(`📴 Canal destruido: ${channel.id}`);
                // Buscar el phoneNumber asociado a este canal
                const phoneNumber = this.pendingCalls.get(channel.id);
                if (phoneNumber) {
                    this.pendingCalls.delete(channel.id);
                    console.log(`📴 Llamada fallida para: ${phoneNumber}`);
                }
                // Emitir evento para que campaignManager maneje la limpieza
                this.emit('callFailed', {
                    channelId: channel.id,
                    phoneNumber: phoneNumber || null,
                    reason: 'destroyed'
                });
            });

            // Manejar estados de canal (para detectar llamadas no contestadas)
            this.client.on('ChannelStateChange', (event, channel) => {
                console.log(`📞 Estado canal ${channel.id}: ${channel.state}`);
                // Si el canal pasa a "busy" o similar, la llamada falló
                if (['busy', 'congestion', 'noanswer'].includes(channel.state)) {
                    const phoneNumber = this.pendingCalls.get(channel.id);
                    if (phoneNumber) {
                        this.pendingCalls.delete(channel.id);
                    }
                    this.emit('callFailed', {
                        channelId: channel.id,
                        phoneNumber: phoneNumber || null,
                        reason: channel.state
                    });
                }
            });

        } catch (error) {
            console.error('❌ Error conectando a ARI:', error);
            this.connected = false;
            throw error;
        }
    }

    async originateCall(phoneNumber, context = 'voicebot-ari') {
        if (!this.connected) {
            throw new Error('ARI no está conectado');
        }

        try {
            const fullNumber = `96307${phoneNumber}`;
            const endpoint = `PJSIP/${fullNumber}@trunk-navetec`;

            console.log(`📞 Originando llamada ARI a: ${phoneNumber}`);

            // Originar llamada con ARI
            const channel = this.client.Channel();

            await channel.originate({
                endpoint: endpoint,
                app: 'voicebot',
                appArgs: phoneNumber, // Pasar el número como argumento
                callerId: process.env.TRUNK_CALLER_ID || 'Voicebot',
                timeout: 30
            });

            // Guardar relación channelId -> phoneNumber para tracking
            if (channel.id) {
                this.pendingCalls.set(channel.id, phoneNumber);
                console.log(`📋 Registrada llamada pendiente: ${channel.id} -> ${phoneNumber}`);
            }

            console.log(`✅ Llamada ARI originada a ${phoneNumber}`);

            return {
                success: true,
                phoneNumber: phoneNumber,
                channelId: channel.id
            };

        } catch (error) {
            console.error(`❌ Error originando llamada ARI:`, error);
            throw error;
        }
    }

    async handleStasisStart(event, channel) {
        console.log(`🎯 StasisStart: ${channel.name} (${channel.id})`);
        console.log(`   Estado: ${channel.state}`);
        console.log(`   Caller: ${channel.caller.number}`);

        // Obtener el número de teléfono de los argumentos de Stasis
        const phoneNumber = event.args[0] || 'unknown';
        console.log(`📱 Número de teléfono: ${phoneNumber}`);

        // Limpiar de pendingCalls ya que la llamada fue contestada
        this.pendingCalls.delete(channel.id);

        try {
            // Contestar el canal
            await channel.answer();
            console.log(`✅ Canal contestado: ${channel.id}`);

            // Crear un puente de audio
            const bridge = this.client.Bridge();
            await bridge.create({ type: 'mixing' });
            console.log(`🌉 Puente creado: ${bridge.id}`);

            // Agregar el canal al puente
            await bridge.addChannel({ channel: channel.id });
            console.log(`✅ Canal agregado al puente`);

            // Guardar información de la llamada
            this.activeCalls.set(channel.id, {
                channel: channel,
                bridge: bridge,
                phoneNumber: phoneNumber,
                startTime: new Date()
            });

            // Emitir evento para que campaignManager maneje la conversación
            this.emit('callAnswered', {
                channelId: channel.id,
                bridgeId: bridge.id,
                phoneNumber: phoneNumber,
                channel: channel,
                bridge: bridge
            });

        } catch (error) {
            console.error('❌ Error en StasisStart:', error);
            try {
                await channel.hangup();
            } catch (hangupError) {
                // Ignorar errores al colgar
            }
        }
    }

    async handleStasisEnd(event, channel) {
        console.log(`📴 StasisEnd: ${channel.name} (${channel.id})`);

        // Limpiar datos de la llamada
        const callData = this.activeCalls.get(channel.id);
        if (callData && callData.bridge) {
            try {
                await callData.bridge.destroy();
                console.log(`🌉 Puente destruido: ${callData.bridge.id}`);
            } catch (error) {
                // Ignorar errores al destruir el puente
            }
        }

        this.activeCalls.delete(channel.id);
    }

    // Verificar si un bridge todavía existe/está activo
    isBridgeActive(bridgeId) {
        return Array.from(this.activeCalls.values()).some(c => c.bridge?.id === bridgeId);
    }

    async playAudio(bridgeId, audioPath, channelId = null) {
        try {
            // Verificar si el bridge sigue activo (usuario no colgó)
            if (!this.isBridgeActive(bridgeId)) {
                console.log(`📴 Bridge ${bridgeId} ya no existe (usuario colgó)`);
                return false;
            }

            // Quitar extensión del path
            const soundPath = audioPath.replace(/\.(wav|ulaw|alaw|gsm|sln16|sln|mp3)$/i, '');
            console.log(`🔊 Reproduciendo: ${soundPath}`);

            // Obtener canal de la llamada activa
            const callData = Array.from(this.activeCalls.values()).find(c => c.bridge?.id === bridgeId);
            const targetChannelId = channelId || callData?.channel?.id;

            let playback;

            if (targetChannelId) {
                const channel = this.client.Channel();
                channel.id = targetChannelId;
                playback = await channel.play({ media: `sound:${soundPath}` });
            } else {
                const bridge = this.client.Bridge();
                bridge.id = bridgeId;
                playback = await bridge.play({ media: `sound:${soundPath}` });
            }

            // Esperar que termine
            await new Promise((resolve) => {
                playback.once('PlaybackFinished', resolve);
                playback.once('PlaybackFailed', resolve);
                setTimeout(resolve, 30000); // timeout 30s
            });

            return true;
        } catch (error) {
            // No mostrar como error si es porque el canal/bridge ya no existe
            if (error.message?.includes('not found') || error.message?.includes('not in Stasis')) {
                console.log(`📴 Llamada terminada (usuario colgó): ${error.message}`);
            } else {
                console.error('❌ Error reproduciendo:', error.message);
            }
            return false;
        }
    }

    async recordAudioFromBridge(bridgeId, recordingName, maxDuration = 8) {
        try {
            // Verificar si el bridge sigue activo (usuario no colgó)
            if (!this.isBridgeActive(bridgeId)) {
                console.log(`📴 Bridge ${bridgeId} ya no existe (usuario colgó)`);
                return null;
            }

            console.log(`🎤 Grabando audio del bridge ${bridgeId}`);

            // Solo pasar el nombre del archivo, sin path ni extensión
            const cleanName = recordingName.replace('.wav', '').split('/').pop();

            const bridge = this.client.Bridge();
            bridge.id = bridgeId;

            const recording = await bridge.record({
                name: cleanName,
                format: 'wav',
                maxDurationSeconds: maxDuration,
                maxSilenceSeconds: 0.8, // 800ms de silencio - balance entre latencia y no cortar al cliente
                ifExists: 'overwrite',
                beep: false,
                terminateOn: 'none'
            });

            console.log(`🎤 Grabación iniciada: ${recording.name}`);

            // Esperar a que termine la grabación con timeout
            const recordingResult = await Promise.race([
                new Promise((resolve) => {
                    recording.once('RecordingFinished', (event) => {
                        console.log(`✅ RecordingFinished event:`, event);
                        resolve({ success: true, event });
                    });
                    recording.once('RecordingFailed', (event) => {
                        console.log(`❌ RecordingFailed event:`, event);
                        resolve({ success: false, event });
                    });
                }),
                new Promise((resolve) => {
                    setTimeout(() => {
                        console.log(`⏰ Timeout grabación`);
                        resolve({ success: false, timeout: true });
                    }, (maxDuration + 1) * 1000);
                })
            ]);

            if (!recordingResult.success) {
                console.log(`⚠️  Grabación no completada exitosamente`);
                // Intentar detener la grabación
                try {
                    await recording.stop();
                } catch (e) {
                    // Ignorar errores al detener
                }
            }

            console.log(`✅ Grabación finalizada`);

            // Retornar el path completo donde Asterisk guarda las grabaciones
            return `/var/spool/asterisk/recording/${cleanName}.wav`;

        } catch (error) {
            // No mostrar como error si es porque el canal/bridge ya no existe
            if (error.message?.includes('not found') || error.message?.includes('not in Stasis')) {
                console.log(`📴 Llamada terminada durante grabación (usuario colgó)`);
            } else {
                console.error('❌ Error grabando audio:', error.message);
            }
            return null;
        }
    }

    async hangup(channelId) {
        try {
            const channel = this.client.Channel();
            channel.id = channelId;
            await channel.hangup();
            console.log(`📴 Canal colgado: ${channelId}`);
        } catch (error) {
            // No mostrar error si el canal ya no existe (usuario ya colgó)
            if (error.message?.includes('not found') || error.message?.includes('not in Stasis')) {
                console.log(`📴 Canal ${channelId} ya no existe (usuario ya colgó)`);
            } else {
                console.error('❌ Error colgando canal:', error.message);
            }
        }
    }

    isConnected() {
        return this.connected;
    }

    getActiveCall(channelId) {
        return this.activeCalls.get(channelId);
    }

    disconnect() {
        if (this.client) {
            this.client.stop('voicebot');
            this.connected = false;
            console.log('🔌 ARI desconectado');
        }
    }
}

// Singleton
const ariManager = new ARIManager();

module.exports = ariManager;
