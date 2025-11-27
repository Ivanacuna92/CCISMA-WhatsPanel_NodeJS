const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class AudioHandler {
    constructor() {
        this.recordingsPath = process.env.VOICEBOT_RECORDING_PATH || '/tmp/voicebot_recordings';
        this.silenceThreshold = 1; // reducido a 1 segundo para respuestas más rápidas
        this.maxRecordingTime = 8; // reducido a 8 segundos por turno
    }

    async initialize() {
        // Crear directorio de grabaciones si no existe
        try {
            await fs.mkdir(this.recordingsPath, { recursive: true });
            console.log(`📁 Directorio de grabaciones: ${this.recordingsPath}`);
        } catch (error) {
            console.error('Error creando directorio de grabaciones:', error);
        }
    }

    /**
     * Genera una ruta única para un archivo de audio
     */
    generateAudioPath(callId, sequence, type = 'input') {
        const timestamp = Date.now();
        const filename = `call_${callId}_${sequence}_${type}_${timestamp}.wav`;
        return path.join(this.recordingsPath, filename);
    }

    /**
     * Graba audio del cliente usando Asterisk AGI
     * Retorna la ruta del archivo grabado
     */
    async recordClientAudio(session, callId, sequence) {
        const audioPath = this.generateAudioPath(callId, sequence, 'input');
        const relativeAudioPath = path.basename(audioPath);

        try {
            console.log(`🎤 Iniciando grabación del cliente...`);

            // Comando AGI para grabar
            // RECORD FILE filename format escape_digits timeout [offset_samples] [BEEP] [silence]
            const result = await session.exec(
                'RECORD',
                `/tmp/voicebot_recordings/${path.basename(audioPath, '.wav')}`,
                'wav',
                '#',  // Termina con # o...
                this.maxRecordingTime * 1000,  // timeout en ms
                '0',  // offset
                'BEEP',  // beep antes de grabar
                `s=${this.silenceThreshold}`  // silencio de X segundos termina la grabación
            );

            // Verificar que el archivo existe
            try {
                await fs.access(audioPath);
                console.log(`✅ Audio grabado: ${audioPath}`);
                return audioPath;
            } catch (error) {
                console.error('❌ Archivo de audio no encontrado:', audioPath);
                return null;
            }
        } catch (error) {
            console.error('❌ Error grabando audio:', error);
            return null;
        }
    }

    /**
     * Mejora audio del cliente para mejor transcripción con Whisper
     */
    async enhanceAudioForWhisper(inputPath) {
        const outputPath = inputPath.replace('.wav', '_enhanced.wav');

        try {
            // Procesamiento optimizado para voz telefónica:
            // 1. 16kHz mono (formato óptimo para Whisper)
            // 2. Filtro de ruido telefónico (300-3400Hz es el rango telefónico)
            // 3. Normalización de volumen
            // 4. Reducción de ruido de fondo
            // 5. Compresión para nivelar volumen
            await execAsync(
                `sox "${inputPath}" -r 16000 -c 1 "${outputPath}" \
                highpass 300 \
                lowpass 3400 \
                norm -1 \
                compand 0.3,1 6:-70,-60,-20 -5 -90 0.2 \
                silence 1 0.1 0.1% reverse silence 1 0.1 0.1% reverse`
            );

            console.log(`✅ Audio mejorado para Whisper: ${outputPath}`);
            return outputPath;
        } catch (error) {
            console.warn('⚠️  Usando audio original:', error.message);
            return inputPath;
        }
    }

    /**
     * Reproduce audio al cliente usando Asterisk AGI
     */
    async playAudioToClient(session, audioPath) {
        try {
            console.log(`🔊 Reproduciendo audio al cliente: ${audioPath}`);

            // Copiar archivo al directorio de sonidos de Asterisk si es necesario
            const asteriskSoundsPath = '/var/lib/asterisk/sounds/custom';
            await fs.mkdir(asteriskSoundsPath, { recursive: true });

            const filename = path.basename(audioPath, '.wav');
            const destPath = path.join(asteriskSoundsPath, `${filename}.wav`);

            // Copiar archivo
            await fs.copyFile(audioPath, destPath);

            // Reproducir (sin extensión .wav)
            await session.streamFile(`custom/${filename}`, '');

            console.log(`✅ Audio reproducido correctamente`);
            return true;
        } catch (error) {
            console.error('❌ Error reproduciendo audio:', error);
            return false;
        }
    }

    /**
     * Convierte audio TTS para Asterisk
     */
    async convertForAsteriskPlayback(inputPath) {
        const wavPath = inputPath.replace(/\.(wav|mp3)$/, '_ast.wav');
        try {
            await execAsync(`sox "${inputPath}" -r 8000 -c 1 "${wavPath}"`);
            return wavPath;
        } catch (error) {
            console.error('❌ Error convirtiendo:', error.message);
            throw error;
        }
    }

    /**
     * Convierte audio TTS directo al destino (sin archivo intermedio)
     * Optimizado para menor latencia
     * Soporta PCM raw (24kHz 16-bit mono) y MP3
     */
    async convertForAsteriskPlaybackDirect(inputPath, outputPath) {
        try {
            // Detectar si es PCM raw (de OpenAI TTS con response_format: 'pcm')
            const isPCM = inputPath.endsWith('.pcm');

            if (isPCM) {
                // PCM de OpenAI: 24kHz, 16-bit signed little-endian, mono
                // Convertir directo a WAV 8kHz para Asterisk (mejor calidad que MP3→WAV)
                await execAsync(`sox -t raw -r 24000 -b 16 -c 1 -e signed-integer -L "${inputPath}" -r 8000 "${outputPath}"`);
                console.log(`✅ PCM→WAV convertido: ${outputPath}`);
            } else {
                // MP3 u otro formato: conversión estándar
                await execAsync(`sox "${inputPath}" -r 8000 -c 1 -b 16 "${outputPath}" rate -v 8000`);
            }
            return outputPath;
        } catch (error) {
            console.error('❌ Error convirtiendo:', error.message);
            throw error;
        }
    }

    /**
     * Limpia archivos de audio antiguos (más de 24 horas)
     */
    async cleanupOldRecordings() {
        try {
            const files = await fs.readdir(this.recordingsPath);
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 horas

            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(this.recordingsPath, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtimeMs > maxAge) {
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                console.log(`🗑️  ${deletedCount} archivos de audio antiguos eliminados`);
            }
        } catch (error) {
            console.error('Error limpiando grabaciones:', error);
        }
    }

    /**
     * Detecta si hay voz en el audio (para evitar procesar silencios)
     */
    async hasVoiceActivity(audioPath) {
        try {
            // Usar sox para detectar nivel de audio
            const { stdout } = await execAsync(
                `sox "${audioPath}" -n stat 2>&1 | grep "^RMS.*amplitude:" | head -1 | awk '{print $3}'`
            );

            const rmsLevel = parseFloat(stdout.trim());

            // Si el RMS es muy bajo o NaN, probablemente es silencio
            if (isNaN(rmsLevel)) {
                console.log(`⚠️  No se pudo leer el nivel RMS, asumiendo que hay voz`);
                return true;
            }

            // Umbral MUY bajo para detectar voz (0.001 = 0.1% de amplitud)
            // En llamadas telefónicas el audio suele tener bajo nivel
            const hasVoice = rmsLevel > 0.001;

            console.log(`🔊 Nivel de audio (RMS): ${rmsLevel.toFixed(6)} - ${hasVoice ? 'Voz detectada' : 'Silencio'}`);

            return hasVoice;
        } catch (error) {
            console.warn('⚠️  No se pudo detectar actividad de voz, asumiendo que hay voz');
            return true; // En caso de error, asumir que hay voz
        }
    }

    /**
     * Obtiene la duración de un archivo de audio en segundos
     */
    async getAudioDuration(audioPath) {
        try {
            const { stdout } = await execAsync(
                `sox "${audioPath}" -n stat 2>&1 | grep "Length" | awk '{print $3}'`
            );

            const duration = parseFloat(stdout.trim());
            console.log(`⏱️  Duración del audio: ${duration} segundos`);

            return duration;
        } catch (error) {
            console.warn('⚠️  No se pudo obtener duración del audio');
            return 0;
        }
    }
}

module.exports = new AudioHandler();
