const database = require('./src/services/database');

(async () => {
    try {
        console.log('📅 Insertando cita faltante del 30 de noviembre...');

        // Datos de la última llamada (ID 34)
        const appointmentData = {
            call_id: 34,
            contact_id: 20,
            campaign_id: 21,
            phone_number: '7714144641',
            client_name: 'Ulises Vera',
            appointment_date: '2025-11-30',
            appointment_time: '15:00',
            appointment_datetime: '2025-11-30 15:00:00',
            appointment_notes: 'Cliente agendó visita para el 30 de noviembre a las 3 de la tarde',
            interest_level: 'high',
            agreement_reached: 1,
            status: 'scheduled'
        };

        const appointmentId = await database.insert('voicebot_appointments', appointmentData);

        console.log('✅ Cita creada con ID:', appointmentId);

        // Verificar
        const appointment = await database.findOne('voicebot_appointments', 'id = ?', [appointmentId]);
        console.log('\n📋 Cita guardada:');
        console.log(JSON.stringify(appointment, null, 2));

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
})();
