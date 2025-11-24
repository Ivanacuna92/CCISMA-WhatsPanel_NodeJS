require('dotenv').config();
const ariManager = require('./src/services/voicebot/ariManager');
const openaiVoice = require('./src/services/voicebot/openaiVoice');
const audioHandler = require('./src/services/voicebot/audioHandler');
const fs = require('fs').promises;
const path = require('path');

async function test() {
    try {
        console.log('🤖 Iniciando prueba completa del voicebot con OpenAI...\n');

        // Inicializar componentes
        await audioHandler.initialize();
        await ariManager.connect();

        // Escuchar llamadas contestadas
        ariManager.on('callAnswered', async (callData) => {
            console.log('🎉 ¡Llamada contestada!');
            console.log(`   Canal: ${callData.channelId}`);
            console.log(`   Puente: ${callData.bridgeId}\n`);

            try {
                // Mensaje de bienvenida
                const greeting = 'Hola, buenos días. Soy el asistente virtual de Navetec. Te llamo para presentarte una nave industrial que tenemos disponible en tu zona. ¿Tienes un momento para que te cuente?';

                console.log('🔊 Generando audio con OpenAI TTS...');
                console.log(`   Texto: "${greeting}"\n`);

                // Generar audio con TTS (ahora retorna MP3)
                const audioPath = path.join('/tmp', `voicebot_test_${Date.now()}.wav`);
                const ttsResult = await openaiVoice.textToSpeech(greeting, audioPath);
                console.log('✅ Audio generado:', ttsResult.path);

                // Convertir para Asterisk (usar el path del MP3)
                const asteriskAudioPath = await audioHandler.convertForAsteriskPlayback(ttsResult.path);
                console.log('✅ Audio convertido para Asterisk');

                // Copiar a directorio de Asterisk (usar data directory, no varlib)
                const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';
                await fs.mkdir(asteriskSoundsPath, { recursive: true });
                const filename = path.basename(asteriskAudioPath, '.gsm');
                const destPath = path.join(asteriskSoundsPath, `${filename}.gsm`);
                await fs.copyFile(asteriskAudioPath, destPath);
                console.log('✅ Audio copiado a Asterisk sounds\n');

                // Reproducir en el canal del cliente
                console.log('🔊 Reproduciendo audio al cliente...');
                const soundPath = `custom/${filename}`;
                await ariManager.playAudio(callData.bridgeId, soundPath, callData.channelId);
                console.log('✅ Audio reproducido exitosamente!\n');

                // Esperar 2 segundos
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Despedida
                const goodbye = 'Perfecto. Un asesor se comunicará contigo pronto. Que tengas excelente día.';
                console.log('🔊 Generando despedida...');
                console.log(`   Texto: "${goodbye}"\n`);

                const audioPath2 = path.join('/tmp', `voicebot_test_${Date.now()}.wav`);
                const ttsResult2 = await openaiVoice.textToSpeech(goodbye, audioPath2);
                const asteriskAudioPath2 = await audioHandler.convertForAsteriskPlayback(ttsResult2.path);
                const filename2 = path.basename(asteriskAudioPath2, '.gsm');
                const destPath2 = path.join(asteriskSoundsPath, `${filename2}.gsm`);
                await fs.copyFile(asteriskAudioPath2, destPath2);

                const soundPath2 = `custom/${filename2}`;
                await ariManager.playAudio(callData.bridgeId, soundPath2, callData.channelId);
                console.log('✅ Despedida reproducida!\n');

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
        console.log(`📞 Llamando a ${phoneNumber}...\n`);
        await ariManager.originateCall(phoneNumber);

        // Esperar 60 segundos para la conversación
        await new Promise(resolve => setTimeout(resolve, 60000));

        console.log('\n✅ Prueba completada');
        ariManager.disconnect();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

test();
