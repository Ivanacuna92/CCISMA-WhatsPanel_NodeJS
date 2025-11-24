require('dotenv').config();
const AsteriskManager = require('asterisk-manager');

console.log('🎤 Iniciando llamada de prueba con voicebot\n');

const ami = new AsteriskManager(
    parseInt(process.env.ASTERISK_AMI_PORT) || 5038,
    process.env.ASTERISK_HOST || '127.0.0.1',
    process.env.ASTERISK_AMI_USERNAME || 'voicebot',
    process.env.ASTERISK_AMI_PASSWORD || '',
    true
);

ami.keepConnected();

ami.on('connect', () => {
    console.log('✅ Conectado a Asterisk AMI');

    setTimeout(() => {
        console.log('\n📞 Originando llamada al 7714144641...');
        console.log('💬 El bot conversará contigo sobre naves industriales\n');

        // Originar llamada que active el dialplan completo
        const action = {
            action: 'Originate',
            channel: 'Local/7714144641@voicebot-outbound',
            context: 'voicebot-outbound',
            exten: '7714144641',
            priority: 1,
            timeout: 30000,
            async: 'true',
            callerid: process.env.TRUNK_CALLER_ID || '5212345678',
            // Variables para el AGI
            variable: {
                CAMPAIGN_ID: '999',
                CONTACT_ID: '1',
                CLIENT_NAME: 'Cliente Prueba',
                NAVE_TYPE: 'Industrial',
                NAVE_LOCATION: 'Torreón',
                NAVE_SIZE: '500',
                NAVE_PRICE: '25000'
            }
        };

        ami.action(action, (err, res) => {
            if (err) {
                console.error('❌ Error:', err);
                process.exit(1);
            }
            console.log('✅ Llamada iniciada:', res.message);
            console.log('\n🎧 Responde la llamada y conversa con el bot!');
            console.log('   El bot te preguntará sobre tu interés en naves industriales\n');
        });
    }, 2000);
});

ami.on('error', (err) => {
    console.error('❌ Error AMI:', err);
});

// Mantener vivo
setTimeout(() => {
    console.log('\n⏱️  Timeout - cerrando...');
    process.exit(0);
}, 120000); // 2 minutos
