require('dotenv').config();
const ariManager = require('./src/services/voicebot/ariManager');
const openaiVoice = require('./src/services/voicebot/openaiVoice');
const audioHandler = require('./src/services/voicebot/audioHandler');
const fs = require('fs').promises;
const path = require('path');

async function test() {
    try {
        console.log('🤖 Iniciando prueba de conversación bidireccional con voicebot...\n');

        // Inicializar componentes
        await audioHandler.initialize();
        await ariManager.connect();

        // Escuchar llamadas contestadas
        ariManager.on('callAnswered', async (callData) => {
            console.log('🎉 ¡Llamada contestada!');
            console.log(`   Canal: ${callData.channelId}`);
            console.log(`   Puente: ${callData.bridgeId}\n`);

            const conversationId = callData.channelId;
            let turnNumber = 0;

            try {
                // ===== TURNO 1: BOT SALUDA =====
                turnNumber++;
                const greeting = 'Hola, buenos días. Soy el asistente virtual de Navetec. Te llamo para presentarte una nave industrial que tenemos disponible en tu zona. ¿Tienes un momento para que te cuente?';

                console.log(`\n🔄 TURNO ${turnNumber}: Bot habla`);
                console.log(`🔊 Bot: "${greeting}"\n`);

                await speakToClient(callData, greeting, turnNumber);

                // Esperar 1 segundo después del playback
                await new Promise(resolve => setTimeout(resolve, 1000));

                // ===== TURNO 2: ESCUCHAR CLIENTE =====
                turnNumber++;
                console.log(`\n🔄 TURNO ${turnNumber}: Cliente responde`);
                console.log('🎤 Esperando respuesta del cliente (máximo 10 segundos)...\n');
                console.log('⏰ Tienes 10 segundos para responder después del beep...\n');

                const recordingName = `client_${Date.now()}`;
                const recordingPath = await ariManager.recordAudio(callData.channelId, recordingName, 10, true);

                // Verificar si hay voz
                const hasVoice = await audioHandler.hasVoiceActivity(recordingPath);

                if (!hasVoice) {
                    console.log('⚠️  No se detectó voz del cliente\n');

                    const noResponse = 'No escuché tu respuesta. Te llamaré en otro momento. Que tengas buen día.';
                    turnNumber++;
                    await speakToClient(callData, noResponse, turnNumber);

                    await ariManager.hangup(callData.channelId);
                    return;
                }

                // Transcribir respuesta del cliente
                console.log('📝 Transcribiendo respuesta del cliente...');
                const transcription = await openaiVoice.transcribeAudio(recordingPath);
                console.log(`👤 Cliente dijo: "${transcription.text}"\n`);

                // ===== TURNO 3: BOT RESPONDE =====
                turnNumber++;
                console.log(`\n🔄 TURNO ${turnNumber}: Bot responde a cliente`);
                console.log('🤖 Generando respuesta con GPT...');

                const response = await openaiVoice.generateResponse(
                    transcription.text,
                    conversationId,
                    null,
                    {
                        naveType: 'Industrial',
                        naveLocation: 'Torreón',
                        naveSize: '500',
                        navePrice: '2,500,000'
                    }
                );

                console.log(`🔊 Bot: "${response.text}"\n`);
                await speakToClient(callData, response.text, turnNumber);

                // ===== TURNO 4: ESCUCHAR DE NUEVO =====
                turnNumber++;
                console.log(`\n🔄 TURNO ${turnNumber}: Cliente responde`);
                console.log('🎤 Esperando segunda respuesta del cliente...\n');

                const recordingName2 = `client_${Date.now()}`;
                const recordingPath2 = await ariManager.recordAudio(callData.channelId, recordingName2, 10, false);

                const hasVoice2 = await audioHandler.hasVoiceActivity(recordingPath2);

                if (hasVoice2) {
                    const transcription2 = await openaiVoice.transcribeAudio(recordingPath2);
                    console.log(`👤 Cliente dijo: "${transcription2.text}"\n`);

                    // Responder
                    turnNumber++;
                    const response2 = await openaiVoice.generateResponse(
                        transcription2.text,
                        conversationId
                    );
                    console.log(`🔊 Bot: "${response2.text}"\n`);
                    await speakToClient(callData, response2.text, turnNumber);
                }

                // ===== DESPEDIDA =====
                turnNumber++;
                const goodbye = 'Perfecto. Un asesor se comunicará contigo pronto. Que tengas excelente día.';
                console.log(`\n🔄 TURNO ${turnNumber}: Despedida`);
                console.log(`🔊 Bot: "${goodbye}"\n`);
                await speakToClient(callData, goodbye, turnNumber);

                // Esperar y colgar
                await new Promise(resolve => setTimeout(resolve, 1000));
                await ariManager.hangup(callData.channelId);
                console.log('📴 Llamada finalizada');

            } catch (error) {
                console.error('❌ Error en la conversación:', error);
                try {
                    await ariManager.hangup(callData.channelId);
                } catch (e) {}
            }
        });

        // Originar llamada
        const phoneNumber = process.argv[2] || '7714144641';
        console.log(`📞 Llamando a ${phoneNumber}...`);
        await ariManager.originateCall(phoneNumber);

        // Esperar 120 segundos para la conversación
        await new Promise(resolve => setTimeout(resolve, 120000));

        console.log('\n✅ Prueba completada');
        ariManager.disconnect();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

async function speakToClient(callData, text, turnNumber) {
    try {
        // Generar audio con TTS
        const audioPath = path.join('/tmp', `voicebot_turn_${turnNumber}_${Date.now()}.wav`);
        const ttsResult = await openaiVoice.textToSpeech(text, audioPath);

        // Convertir para Asterisk
        const asteriskAudioPath = await audioHandler.convertForAsteriskPlayback(ttsResult.path);

        // Copiar a directorio de Asterisk
        const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';
        await fs.mkdir(asteriskSoundsPath, { recursive: true });
        const filename = path.basename(asteriskAudioPath, '.gsm');
        const destPath = path.join(asteriskSoundsPath, `${filename}.gsm`);
        await fs.copyFile(asteriskAudioPath, destPath);

        // Reproducir en el canal del cliente
        const soundPath = `custom/${filename}`;
        await ariManager.playAudio(callData.bridgeId, soundPath, callData.channelId);

        console.log('✅ Audio reproducido al cliente');

    } catch (error) {
        console.error('❌ Error reproduciendo audio:', error);
        throw error;
    }
}

test();
