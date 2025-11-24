require('dotenv').config();
const ariManager = require('./src/services/voicebot/ariManager');

async function test() {
    try {
        console.log('🧪 Probando audio de sistema de Asterisk...\n');

        await ariManager.connect();

        ariManager.on('callAnswered', async (callData) => {
            console.log('🎉 Llamada contestada!');
            console.log(`   Canal: ${callData.channelId}\n`);

            try {
                // Esperar 1 segundo
                console.log('⏳ Esperando 1 segundo...');
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Reproducir audio de sistema de Asterisk
                console.log('🔊 Reproduciendo demo-congrats (audio de sistema)...');
                await ariManager.playAudio(callData.bridgeId, 'demo-congrats', callData.channelId);
                console.log('✅ Audio reproducido!\n');

                // Esperar 2 segundos
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Reproducir otro audio de sistema
                console.log('🔊 Reproduciendo demo-thanks...');
                await ariManager.playAudio(callData.bridgeId, 'demo-thanks', callData.channelId);
                console.log('✅ Audio reproducido!\n');

                // Esperar y colgar
                await new Promise(resolve => setTimeout(resolve, 1000));
                await ariManager.hangup(callData.channelId);
                console.log('📴 Llamada finalizada');

            } catch (error) {
                console.error('❌ Error:', error);
                try {
                    await ariManager.hangup(callData.channelId);
                } catch (e) {}
            }
        });

        const phoneNumber = process.argv[2] || '7714144641';
        console.log(`📞 Llamando a ${phoneNumber}...\n`);
        await ariManager.originateCall(phoneNumber);

        await new Promise(resolve => setTimeout(resolve, 30000));

        console.log('\n✅ Prueba completada');
        ariManager.disconnect();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

test();
