require('dotenv').config();
const ariManager = require('./src/services/voicebot/ariManager');

async function test() {
    try {
        console.log('🧪 Probando conexión ARI...');

        // Conectar a ARI
        await ariManager.connect();

        console.log('✅ Conexión ARI exitosa');
        console.log(`   Estado: ${ariManager.isConnected() ? 'Conectado' : 'Desconectado'}`);

        // Escuchar evento de llamada contestada
        ariManager.on('callAnswered', async (callData) => {
            console.log('🎉 ¡Llamada contestada!');
            console.log(`   Número: ${callData.phoneNumber}`);
            console.log(`   Canal: ${callData.channelId}`);
            console.log(`   Puente: ${callData.bridgeId}`);

            // Reproducir audio de prueba
            console.log('\n🔊 Reproduciendo audio de prueba...');
            try {
                await ariManager.playAudio(callData.bridgeId, 'demo-congrats');
                console.log('✅ Audio reproducido exitosamente');
            } catch (error) {
                console.error('❌ Error reproduciendo audio:', error);
            }
        });

        // Hacer una llamada de prueba
        console.log('\n📞 Originando llamada de prueba...');
        const phoneNumber = process.argv[2] || '5512345678';

        await ariManager.originateCall(phoneNumber);

        console.log(`✅ Llamada originada a ${phoneNumber}`);
        console.log('⏳ Esperando 30 segundos para que la llamada se establezca...');

        // Esperar 30 segundos
        await new Promise(resolve => setTimeout(resolve, 30000));

        console.log('\n✅ Prueba completada');

        // Desconectar
        ariManager.disconnect();

        process.exit(0);

    } catch (error) {
        console.error('❌ Error en prueba:', error);
        process.exit(1);
    }
}

test();
