require('dotenv').config();
const voicebotDB = require('./src/services/voicebot/voicebotDatabase');
const AsteriskManager = require('asterisk-manager');

async function createAndLaunchCampaign() {
    try {
        console.log('🚀 Creando campaña de prueba...\n');

        // 1. Crear campaña
        console.log('📋 Creando campaña...');
        const campaignId = await voicebotDB.createCampaign({
            campaignName: 'Test Voicebot - ' + new Date().toLocaleString(),
            csvFilename: 'manual_test.csv',
            totalContacts: 1,
            createdBy: null  // NULL permitido por foreign key constraint
        });
        console.log(`✅ Campaña creada: ID ${campaignId}\n`);

        // 2. Agregar contacto
        console.log('👤 Agregando contacto...');
        const contactId = await voicebotDB.addContact(campaignId, {
            phone: '7714144641',
            name: 'Cliente de Prueba',
            naveType: 'Nave industrial 500m2',
            location: 'Guadalajara, Jalisco',
            size: '500 m2',
            price: '$25,000 MXN/mes',
            extraInfo: 'Ubicación estratégica cerca de autopista',
            advantages: 'Fácil acceso a transporte de carga'
        });
        console.log(`✅ Contacto agregado: ID ${contactId}\n`);

        // 3. Actualizar campaña a "running"
        console.log('🚀 Activando campaña...');
        await voicebotDB.updateCampaignStatus(campaignId, 'running');
        console.log('✅ Campaña activada\n');

        // 4. Conectar a AMI y originar llamada
        console.log('📞 Conectando a Asterisk AMI...');
        const ami = new AsteriskManager(
            parseInt(process.env.ASTERISK_AMI_PORT) || 5038,
            process.env.ASTERISK_HOST || '127.0.0.1',
            process.env.ASTERISK_AMI_USERNAME || 'voicebot',
            process.env.ASTERISK_AMI_PASSWORD || '',
            true
        );

        ami.on('connect', async () => {
            console.log('✅ Conectado a AMI\n');

            // Marcar contacto como "calling"
            await voicebotDB.updateContactStatus(contactId, 'calling');

            console.log('📞 Originando llamada a 7714144641...\n');

            // Originar directamente por PJSIP, cuando conteste ir a AGI
            const action = {
                action: 'Originate',
                channel: 'PJSIP/963077714144641@trunk-navetec',
                application: 'AGI',
                data: 'agi://127.0.0.1:4573,7714144641',
                callerid: '"Navetec" <5212345678>',
                timeout: 30000,
                async: 'true',
                variable: {
                    'PHONE_NUMBER': '7714144641',
                    'CAMPAIGN_ID': campaignId,
                    'CONTACT_ID': contactId
                }
            };

            ami.action(action, (err, res) => {
                if (err) {
                    console.error('❌ Error originando llamada:', err);
                    process.exit(1);
                } else {
                    console.log('✅ Llamada originada exitosamente!');
                    console.log('\n📊 Ahora el servidor principal manejará la conversación');
                    console.log('📝 Monitorea: tail -f /tmp/server_now.log\n');

                    setTimeout(() => {
                        console.log('✅ Test completado');
                        ami.disconnect();
                        process.exit(0);
                    }, 3000);
                }
            });
        });

        ami.on('error', (err) => {
            console.error('❌ Error AMI:', err);
            process.exit(1);
        });

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

createAndLaunchCampaign();
