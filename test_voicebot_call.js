require('dotenv').config();
const campaignManager = require('./src/services/voicebot/campaignManager');

async function testVoicebotCall() {
    console.log('🎤 Prueba de Voicebot con IA\n');

    // Datos del contacto de prueba
    const testContact = {
        id: 17,
        campaign_id: 18,
        phone_number: '7714144641',
        client_name: 'Cliente Prueba',
        nave_type: 'Industrial',
        nave_location: 'Torreón, Coahuila',
        nave_size: '500',
        nave_price: '$25,000 MXN/mes',
        extra_info: 'Nave ideal para almacenamiento y distribución',
        strategic_advantages: 'Excelente ubicación cerca de la carretera principal con acceso a servicios'
    };

    console.log('📋 Datos del contacto:');
    console.log(`   Nombre: ${testContact.client_name}`);
    console.log(`   Teléfono: ${testContact.phone_number}`);
    console.log(`   Nave: ${testContact.nave_type} - ${testContact.nave_size}m²`);
    console.log(`   Ubicación: ${testContact.nave_location}`);
    console.log(`   Precio: ${testContact.nave_price}\n`);

    try {
        // Inicializar el campaign manager si no está inicializado
        if (!campaignManager.isInitialized) {
            console.log('🔧 Inicializando Campaign Manager...');
            await campaignManager.initialize();
            console.log('✅ Campaign Manager inicializado\n');
        }

        console.log('📞 Iniciando llamada con voicebot...');
        console.log('⏳ El bot te llamará, responderá tus preguntas sobre la nave y analizará la conversación\n');

        // Hacer la llamada usando el campaign manager
        await campaignManager.makeCall(testContact);

        console.log('✅ Llamada iniciada correctamente');
        console.log('📱 Deberías recibir la llamada en unos segundos...\n');

        // Mantener el script vivo para monitorear
        console.log('💡 El script seguirá corriendo para monitorear la llamada...');
        console.log('   Presiona Ctrl+C cuando termine la conversación\n');

    } catch (error) {
        console.error('❌ Error en la prueba:', error);
        process.exit(1);
    }
}

// Ejecutar
testVoicebotCall().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});

// Mantener proceso vivo
process.on('SIGINT', () => {
    console.log('\n\n👋 Finalizando prueba...');
    process.exit(0);
});
