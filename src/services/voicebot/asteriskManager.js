const AsteriskManager = require('asterisk-manager');
const EventEmitter = require('events');
require('dotenv').config();

class AsteriskAMI extends EventEmitter {
    constructor() {
        super();
        this.ami = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
    }

    async connect() {
        if (this.connected && this.ami) {
            console.log('✅ AMI ya está conectado');
            return true;
        }

        try {
            this.ami = new AsteriskManager(
                parseInt(process.env.ASTERISK_AMI_PORT) || 5038,
                process.env.ASTERISK_HOST || '127.0.0.1',
                process.env.ASTERISK_AMI_USERNAME || 'voicebot',
                process.env.ASTERISK_AMI_PASSWORD || '',
                true // keepAlive
            );

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout conectando a AMI'));
                }, 10000);

                this.ami.on('connect', () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    console.log('✅ Conectado a Asterisk AMI');
                    this.setupEventListeners();
                    resolve(true);
                });

                this.ami.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error('❌ Error en AMI:', error);
                    this.connected = false;
                    reject(error);
                });

                this.ami.keepConnected();
            });
        } catch (error) {
            console.error('❌ Error conectando a AMI:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Evento cuando una llamada es contestada
        this.ami.on('newchannel', (evt) => {
            console.log('📞 Nuevo canal:', evt.channel);
            this.emit('newChannel', evt);
        });

        // Evento cuando cambia el estado de un canal
        this.ami.on('newstate', (evt) => {
            console.log('🔄 Cambio de estado:', evt.channelstatedesc);
            this.emit('stateChange', evt);
        });

        // Evento cuando cuelgan
        this.ami.on('hangup', (evt) => {
            console.log('📴 Llamada finalizada:', evt.channel);
            this.emit('hangup', evt);
        });

        // Evento de originación
        this.ami.on('originateresponse', (evt) => {
            console.log('📡 Respuesta de originación:', evt.response);
            this.emit('originateResponse', evt);
        });

        // Desconexión
        this.ami.on('close', () => {
            console.warn('⚠️  AMI desconectado');
            this.connected = false;
            this.emit('disconnect');
            this.attemptReconnect();
        });
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Máximo de reintentos alcanzado');
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Reintentando conexión AMI (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect().catch(err => {
                console.error('Error en reconexión:', err);
            });
        }, this.reconnectDelay);
    }

    async originateCall(phoneNumber, context, extension = 's', priority = 1, callerID = null) {
        if (!this.connected) {
            throw new Error('AMI no está conectado');
        }

        const actionId = `voicebot_${Date.now()}`;

        // Usar Local channel pero configurado correctamente
        const channel = `Local/${phoneNumber}@voicebot-outbound-v2`;

        const action = {
            action: 'Originate',
            channel: channel,
            // NO especificar context/exten para evitar ejecución duplicada
            // El Local channel ejecutará el dialplan voicebot-outbound-v2
            timeout: 30000,
            callerid: callerID || process.env.TRUNK_CALLER_ID || 'Voicebot',
            actionid: actionId,
            async: 'true'
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout originando llamada'));
            }, 35000);

            this.ami.action(action, (err, res) => {
                clearTimeout(timeout);

                if (err) {
                    console.error('❌ Error originando llamada:', err);
                    reject(err);
                    return;
                }

                console.log('✅ Llamada originada:', res);
                resolve({
                    success: true,
                    actionId: actionId,
                    channel: channel,
                    response: res
                });
            });
        });
    }

    async hangupCall(channel) {
        if (!this.connected) {
            throw new Error('AMI no está conectado');
        }

        return new Promise((resolve, reject) => {
            this.ami.action({
                action: 'Hangup',
                channel: channel
            }, (err, res) => {
                if (err) {
                    console.error('❌ Error colgando llamada:', err);
                    reject(err);
                    return;
                }

                console.log('✅ Llamada colgada');
                resolve(res);
            });
        });
    }

    async getChannels() {
        if (!this.connected) {
            throw new Error('AMI no está conectado');
        }

        return new Promise((resolve, reject) => {
            this.ami.action({
                action: 'CoreShowChannels'
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(res);
            });
        });
    }

    async sendCommand(command) {
        if (!this.connected) {
            throw new Error('AMI no está conectado');
        }

        return new Promise((resolve, reject) => {
            this.ami.action({
                action: 'Command',
                command: command
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(res);
            });
        });
    }

    isConnected() {
        return this.connected;
    }

    disconnect() {
        if (this.ami) {
            this.ami.disconnect();
            this.connected = false;
            console.log('🔌 AMI desconectado manualmente');
        }
    }
}

// Singleton
const asteriskManager = new AsteriskAMI();

module.exports = asteriskManager;
