require('dotenv').config();
const AsteriskManager = require('asterisk-manager');

console.log('🔧 Conectando al AMI...');
console.log('Usuario:', process.env.ASTERISK_AMI_USERNAME);
console.log('Host:', process.env.ASTERISK_HOST || '127.0.0.1');
console.log('Puerto:', process.env.ASTERISK_AMI_PORT || 5038);

const ami = new AsteriskManager(
    parseInt(process.env.ASTERISK_AMI_PORT) || 5038,
    process.env.ASTERISK_HOST || '127.0.0.1',
    process.env.ASTERISK_AMI_USERNAME || 'voicebot',
    process.env.ASTERISK_AMI_PASSWORD || '',
    true // enable debug
);

ami.keepConnected();

ami.on('connect', () => {
    console.log('✅ Conectado al AMI de Asterisk!');

    setTimeout(() => {
        console.log('📞 Originando llamada al 7714144641...');

        const action = {
            action: 'Originate',
            channel: 'Local/7714144641@voicebot-outbound',
            application: 'Playback',
            data: 'hello-world',
            timeout: 30000,
            async: 'true',
            callerid: process.env.TRUNK_CALLER_ID || '5212345678'
        };

        ami.action(action, (err, res) => {
            if (err) {
                console.error('❌ Error originando llamada:', err);
            } else {
                console.log('✅ Llamada originada:', res);
            }
        });
    }, 2000);
});

ami.on('error', (err) => {
    console.error('❌ Error del AMI:', err);
});

ami.on('close', () => {
    console.log('🔌 Conexión AMI cerrada');
});

// Mantener el script corriendo
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando...');
    process.exit(0);
});
