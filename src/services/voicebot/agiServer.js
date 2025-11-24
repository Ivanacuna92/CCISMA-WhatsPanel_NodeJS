const net = require('net');
const EventEmitter = require('events');

class AGIServer extends EventEmitter {
    constructor(port = 4573) {
        super();
        this.port = port;
        this.server = null;
        this.activeSessions = new Map();
    }

    start() {
        this.server = net.createServer((socket) => {
            const session = new AGISession(socket);

            socket.on('error', (error) => {
                console.error('❌ Error en socket AGI:', error);
            });

            session.on('ready', (variables) => {
                console.log('📞 Nueva sesión AGI:', variables.agi_channel);
                this.activeSessions.set(variables.agi_uniqueid, session);
                this.emit('session', session, variables);
            });

            session.on('end', () => {
                this.activeSessions.delete(session.uniqueid);
            });
        });

        this.server.listen(this.port, () => {
            console.log(`🎯 Servidor AGI escuchando en puerto ${this.port}`);
        });

        this.server.on('error', (error) => {
            console.error('❌ Error en servidor AGI:', error);
            throw error;
        });
    }

    stop() {
        if (this.server) {
            this.server.close(() => {
                console.log('🔌 Servidor AGI detenido');
            });
        }
    }

    getSession(uniqueid) {
        return this.activeSessions.get(uniqueid);
    }

    getActiveSessions() {
        return Array.from(this.activeSessions.values());
    }
}

class AGISession extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.variables = {};
        this.buffer = '';
        this.initialized = false;
        this.uniqueid = null;

        this.socket.on('data', (data) => this.handleData(data));
        this.socket.on('end', () => this.handleEnd());
        this.socket.on('error', (err) => this.handleError(err));
    }

    handleData(data) {
        this.buffer += data.toString();

        if (!this.initialized) {
            if (this.buffer.includes('\n\n')) {
                this.parseVariables();
                this.initialized = true;
                this.uniqueid = this.variables.agi_uniqueid;
                this.emit('ready', this.variables);
            }
        } else {
            // Procesar respuestas de comandos
            const lines = this.buffer.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    this.emit('response', line);
                }
            }
            this.buffer = '';
        }
    }

    parseVariables() {
        const lines = this.buffer.split('\n');
        for (const line of lines) {
            const match = line.match(/^agi_(\w+):\s*(.*)$/);
            if (match) {
                this.variables[`agi_${match[1]}`] = match[2];
            }
        }
        this.buffer = '';
    }

    handleEnd() {
        console.log('📴 Sesión AGI finalizada');
        this.emit('end');
    }

    handleError(error) {
        console.error('❌ Error en sesión AGI:', error);
        this.emit('error', error);
    }

    // ==================== COMANDOS AGI ====================

    async exec(command, ...args) {
        return new Promise((resolve, reject) => {
            const argString = args.join(' ');
            const cmd = `EXEC ${command} ${argString}\n`;

            const responseHandler = (response) => {
                this.removeListener('response', responseHandler);

                // Parsear respuesta: 200 result=X (...)
                const match = response.match(/^200 result=(-?\d+)/);
                if (match) {
                    resolve({
                        code: 200,
                        result: parseInt(match[1]),
                        response: response
                    });
                } else {
                    reject(new Error(`Respuesta AGI inválida: ${response}`));
                }
            };

            this.on('response', responseHandler);
            this.socket.write(cmd);

            setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error('Timeout ejecutando comando AGI'));
            }, 10000);
        });
    }

    async answer() {
        return this.exec('Answer');
    }

    async hangup() {
        return this.exec('Hangup');
    }

    async playback(file) {
        return this.exec('Playback', file);
    }

    async streamFile(file, escapeDigits = '""') {
        return this.exec('STREAM FILE', file, escapeDigits);
    }

    async getVariable(varName) {
        return new Promise((resolve, reject) => {
            const cmd = `GET VARIABLE ${varName}\n`;

            const responseHandler = (response) => {
                this.removeListener('response', responseHandler);

                const match = response.match(/^200 result=1 \((.*)\)$/);
                if (match) {
                    resolve(match[1]);
                } else {
                    resolve(null);
                }
            };

            this.on('response', responseHandler);
            this.socket.write(cmd);

            setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error('Timeout obteniendo variable'));
            }, 5000);
        });
    }

    async setVariable(varName, value) {
        return new Promise((resolve, reject) => {
            const cmd = `SET VARIABLE ${varName} "${value}"\n`;

            const responseHandler = (response) => {
                this.removeListener('response', responseHandler);

                if (response.startsWith('200')) {
                    resolve(true);
                } else {
                    reject(new Error(`Error estableciendo variable: ${response}`));
                }
            };

            this.on('response', responseHandler);
            this.socket.write(cmd);

            setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error('Timeout estableciendo variable'));
            }, 5000);
        });
    }

    async verbose(message, level = 1) {
        return this.exec('VERBOSE', `"${message}"`, level);
    }

    async wait(seconds) {
        return this.exec('WAIT FOR DIGIT', (seconds * 1000).toString());
    }

    end() {
        this.socket.end();
    }
}

module.exports = AGIServer;
