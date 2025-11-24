require('dotenv').config();
const voicebotDB = require('./src/services/voicebot/voicebotDatabase');
const campaignManager = require('./src/services/voicebot/campaignManager');

async function testFullVoicebot() {
    try {
        console.log('🚀 Iniciando test completo del voicebot...\n');

        // 1. Inicializar base de datos
        console.log('📊 Inicializando base de datos...');
        await voicebotDB.initialize();
        console.log('✅ Base de datos inicializada\n');

        // 2. Inicializar campaign manager (AGI server, AMI, etc)
        console.log('📞 Inicializando Campaign Manager...');
        await campaignManager.initialize();
        console.log('✅ Campaign Manager inicializado\n');

        // 3. Crear campaña de prueba
        console.log('📋 Creando campaña de prueba...');
        const campaignId = await voicebotDB.createCampaign({
            campaignName: 'Test Voicebot - ' + new Date().toLocaleString(),
            csvFilename: 'manual_test.csv',
            totalContacts: 1,
            createdBy: 'test_script'
        });
        console.log(`✅ Campaña creada: ID ${campaignId}\n`);

        // 4. Agregar contacto de prueba
        console.log('👤 Agregando contacto de prueba...');
        await voicebotDB.addContact(campaignId, {
            phone: '7714144641',
            name: 'Cliente de Prueba',
            naveType: 'Nave industrial 500m2',
            location: 'Guadalajara, Jalisco',
            size: '500 m2',
            price: '$25,000 MXN/mes',
            extraInfo: 'Ubicación estratégica cerca de autopista',
            advantages: 'Fácil acceso a transporte de carga'
        });
        console.log('✅ Contacto agregado\n');

        // 5. Iniciar campaña
        console.log('🚀 Iniciando campaña...');
        await campaignManager.startCampaign(campaignId);
        console.log('✅ Campaña iniciada - La llamada se realizará automáticamente\n');

        console.log('📞 El sistema hará la llamada y manejará la conversación completa');
        console.log('📊 Monitorea los logs para ver el progreso\n');

        // Mantener el script corriendo por 5 minutos
        console.log('⏰ Script activo por 5 minutos...');
        await new Promise(resolve => setTimeout(resolve, 300000));

        console.log('\n✅ Test completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error en test:', error);
        process.exit(1);
    }
}

testFullVoicebot();
