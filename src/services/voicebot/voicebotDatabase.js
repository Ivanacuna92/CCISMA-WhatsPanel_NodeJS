const database = require('../database');

class VoicebotDatabase {
    // ==================== CAMPAIGNS ====================

    async createCampaign(data) {
        const campaignId = await database.insert('voicebot_campaigns', {
            campaign_name: data.campaignName,
            csv_filename: data.csvFilename,
            total_contacts: data.totalContacts || 0,
            created_by: data.createdBy,
            status: 'pending'
        });
        return campaignId;
    }

    async getCampaign(campaignId) {
        return await database.findOne('voicebot_campaigns', 'id = ?', [campaignId]);
    }

    async getAllCampaigns(limit = 50) {
        const sql = `SELECT * FROM voicebot_campaigns ORDER BY created_at DESC LIMIT ?`;
        return await database.query(sql, [limit]);
    }

    async getCampaignsByStatus(status, limit = 50) {
        const sql = `SELECT * FROM voicebot_campaigns WHERE status = ? ORDER BY created_at DESC LIMIT ?`;
        return await database.query(sql, [status, limit]);
    }

    async updateCampaignStatus(campaignId, status) {
        const updateData = { status };

        if (status === 'running' && !await this.getCampaignStartTime(campaignId)) {
            updateData.started_at = new Date();
        } else if (status === 'completed' || status === 'cancelled') {
            updateData.completed_at = new Date();
        }

        return await database.update('voicebot_campaigns', updateData, 'id = ?', [campaignId]);
    }

    async getCampaignStartTime(campaignId) {
        const campaign = await this.getCampaign(campaignId);
        return campaign?.started_at;
    }

    async updateCampaignStats(campaignId) {
        const sql = `
            UPDATE voicebot_campaigns
            SET
                calls_completed = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'completed'),
                calls_pending = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'pending'),
                calls_failed = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'failed'),
                appointments_scheduled = (SELECT COUNT(*) FROM voicebot_appointments WHERE campaign_id = ?)
            WHERE id = ?
        `;
        return await database.query(sql, [campaignId, campaignId, campaignId, campaignId, campaignId]);
    }

    // ==================== CONTACTS ====================

    async addContact(campaignId, contactData) {
        return await database.insert('voicebot_contacts', {
            campaign_id: campaignId,
            phone_number: contactData.phone,
            client_name: contactData.name,
            nave_type: contactData.naveType,
            nave_location: contactData.location,
            nave_size: contactData.size,
            nave_price: contactData.price,
            extra_info: contactData.extraInfo,
            strategic_advantages: contactData.advantages,
            call_status: 'pending'
        });
    }

    async getContact(contactId) {
        return await database.findOne('voicebot_contacts', 'id = ?', [contactId]);
    }

    async getContactByPhone(campaignId, phone) {
        return await database.findOne('voicebot_contacts', 'campaign_id = ? AND phone_number = ?', [campaignId, phone]);
    }

    async getPendingContacts(campaignId, limit = 1) {
        const sql = `
            SELECT * FROM voicebot_contacts
            WHERE campaign_id = ? AND call_status = 'pending'
            ORDER BY id ASC
            LIMIT ?
        `;
        return await database.query(sql, [campaignId, limit]);
    }

    async updateContactStatus(contactId, status) {
        return await database.update('voicebot_contacts', {
            call_status: status,
            last_attempt_at: new Date()
        }, 'id = ?', [contactId]);
    }

    async incrementCallAttempts(contactId) {
        const sql = `UPDATE voicebot_contacts SET call_attempts = call_attempts + 1, last_attempt_at = NOW() WHERE id = ?`;
        return await database.query(sql, [contactId]);
    }

    // ==================== CALLS ====================

    async createCall(callData) {
        return await database.insert('voicebot_calls', {
            contact_id: callData.contactId,
            campaign_id: callData.campaignId,
            phone_number: callData.phoneNumber,
            call_start: new Date(),
            call_status: 'ringing',
            asterisk_channel: callData.channel,
            asterisk_uniqueid: callData.uniqueId
        });
    }

    async getCall(callId) {
        return await database.findOne('voicebot_calls', 'id = ?', [callId]);
    }

    async getCallByUniqueId(uniqueId) {
        return await database.findOne('voicebot_calls', 'asterisk_uniqueid = ?', [uniqueId]);
    }

    async updateCallStatus(callId, status, endTime = null) {
        const updateData = { call_status: status };

        if (endTime) {
            updateData.call_end = endTime;
            const call = await this.getCall(callId);
            if (call && call.call_start) {
                const duration = Math.floor((new Date(endTime) - new Date(call.call_start)) / 1000);
                updateData.duration_seconds = duration;
            }
        }

        return await database.update('voicebot_calls', updateData, 'id = ?', [callId]);
    }

    async setCallRecording(callId, recordingPath) {
        return await database.update('voicebot_calls', {
            audio_recording_path: recordingPath
        }, 'id = ?', [callId]);
    }

    // ==================== TRANSCRIPTIONS ====================

    async addTranscription(callId, transcriptionData) {
        return await database.insert('voicebot_transcriptions', {
            call_id: callId,
            sequence_number: transcriptionData.sequence || 0,
            speaker: transcriptionData.speaker || 'unknown',
            audio_chunk_path: transcriptionData.audioPath || null,
            transcription: transcriptionData.text || null,
            response_text: transcriptionData.response || null,
            confidence_score: transcriptionData.confidence || 0,
            processing_time_ms: transcriptionData.processingTime || 0
        });
    }

    async getTranscriptions(callId) {
        return await database.findAll('voicebot_transcriptions', 'call_id = ?', [callId], 'sequence_number ASC');
    }

    async getFullConversation(callId) {
        const transcriptions = await this.getTranscriptions(callId);

        return transcriptions.map(t => ({
            speaker: t.speaker,
            text: t.transcription,
            response: t.response_text,
            timestamp: t.timestamp
        }));
    }

    // ==================== APPOINTMENTS ====================

    async createAppointment(appointmentData) {
        return await database.insert('voicebot_appointments', {
            call_id: appointmentData.callId,
            contact_id: appointmentData.contactId,
            campaign_id: appointmentData.campaignId,
            phone_number: appointmentData.phoneNumber,
            client_name: appointmentData.clientName,
            appointment_date: appointmentData.date,
            appointment_time: appointmentData.time,
            appointment_datetime: appointmentData.datetime,
            appointment_notes: appointmentData.notes,
            interest_level: appointmentData.interestLevel || 'medium',
            agreement_reached: appointmentData.agreementReached || false,
            status: 'scheduled'
        });
    }

    async getAppointment(appointmentId) {
        return await database.findOne('voicebot_appointments', 'id = ?', [appointmentId]);
    }

    async getAppointmentsByCall(callId) {
        return await database.findAll('voicebot_appointments', 'call_id = ?', [callId]);
    }

    async getAppointmentsByCampaign(campaignId) {
        const sql = `
            SELECT
                a.*,
                co.client_name,
                co.phone_number,
                co.nave_type,
                co.nave_location,
                co.nave_size,
                co.nave_price,
                ca.call_start,
                ca.duration_seconds,
                c.campaign_name
            FROM voicebot_appointments a
            LEFT JOIN voicebot_contacts co ON a.contact_id = co.id
            LEFT JOIN voicebot_calls ca ON a.call_id = ca.id
            LEFT JOIN voicebot_campaigns c ON a.campaign_id = c.id
            WHERE a.campaign_id = ?
            ORDER BY a.created_at DESC
        `;
        return await database.query(sql, [campaignId]);
    }

    async getAllAppointments() {
        const sql = `
            SELECT
                a.*,
                co.client_name,
                co.phone_number,
                co.nave_type,
                co.nave_location,
                co.nave_size,
                co.nave_price,
                ca.call_start,
                ca.duration_seconds,
                c.campaign_name
            FROM voicebot_appointments a
            LEFT JOIN voicebot_contacts co ON a.contact_id = co.id
            LEFT JOIN voicebot_calls ca ON a.call_id = ca.id
            LEFT JOIN voicebot_campaigns c ON a.campaign_id = c.id
            ORDER BY a.created_at DESC
        `;
        return await database.query(sql);
    }

    async updateAppointmentStatus(appointmentId, status) {
        return await database.update('voicebot_appointments', { status }, 'id = ?', [appointmentId]);
    }

    // ==================== CONFIG ====================

    async getConfig(key) {
        const config = await database.findOne('voicebot_config', 'config_key = ?', [key]);
        return config ? config.config_value : null;
    }

    async setConfig(key, value, updatedBy = null) {
        const exists = await database.findOne('voicebot_config', 'config_key = ?', [key]);

        if (exists) {
            return await database.update('voicebot_config', {
                config_value: value,
                updated_by: updatedBy
            }, 'config_key = ?', [key]);
        } else {
            return await database.insert('voicebot_config', {
                config_key: key,
                config_value: value,
                updated_by: updatedBy
            });
        }
    }

    async getAllConfig() {
        return await database.findAll('voicebot_config', '1=1');
    }

    // ==================== STATISTICS ====================

    async getCampaignStats(campaignId) {
        const sql = `
            SELECT
                c.id,
                c.campaign_name,
                c.total_contacts,
                c.status,
                COUNT(DISTINCT co.id) as total_contacts_loaded,
                COUNT(DISTINCT CASE WHEN co.call_status = 'completed' THEN co.id END) as calls_completed,
                COUNT(DISTINCT CASE WHEN co.call_status = 'failed' THEN co.id END) as calls_failed,
                COUNT(DISTINCT CASE WHEN co.call_status = 'pending' THEN co.id END) as calls_pending,
                COUNT(DISTINCT a.id) as appointments_scheduled,
                AVG(CASE WHEN ca.duration_seconds > 0 THEN ca.duration_seconds END) as avg_call_duration
            FROM voicebot_campaigns c
            LEFT JOIN voicebot_contacts co ON c.id = co.campaign_id
            LEFT JOIN voicebot_calls ca ON c.id = ca.campaign_id
            LEFT JOIN voicebot_appointments a ON c.id = a.campaign_id
            WHERE c.id = ?
            GROUP BY c.id
        `;

        const results = await database.query(sql, [campaignId]);
        return results[0] || null;
    }
}

module.exports = new VoicebotDatabase();
