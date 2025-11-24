import { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, CheckCircle } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function VoicebotConfig() {
    const [config, setConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            setLoading(true);
            const data = await voicebotApi.getConfig();
            setConfig(data || {});
        } catch (error) {
            console.error('Error cargando configuración:', error);
            setStatus({ type: 'error', message: 'Error cargando configuración' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key, value) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);

        try {
            await voicebotApi.updateConfig(config);
            setStatus({ type: 'success', message: 'Configuración guardada exitosamente' });

            setTimeout(() => setStatus(null), 3000);
        } catch (error) {
            console.error('Error guardando configuración:', error);
            setStatus({ type: 'error', message: 'Error guardando configuración' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-white rounded-lg shadow p-6">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navetec-primary mx-auto"></div>
                    <p className="text-gray-500 mt-4">Cargando configuración...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold flex items-center">
                    <Settings className="h-7 w-7 mr-2" />
                    Configuración del Voicebot
                </h2>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-navetec-primary text-white rounded-lg hover:bg-navetec-dark disabled:opacity-50 flex items-center"
                >
                    {saving ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Guardando...
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4 mr-2" />
                            Guardar Cambios
                        </>
                    )}
                </button>
            </div>

            {status && (
                <div className={`mb-6 p-4 rounded-lg ${
                    status.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                    <div className="flex items-center">
                        {status.type === 'success' ?
                            <CheckCircle className="h-5 w-5 mr-2" /> :
                            <AlertCircle className="h-5 w-5 mr-2" />
                        }
                        <p className="text-sm">{status.message}</p>
                    </div>
                </div>
            )}

            <div className="space-y-6">
                {/* System Prompt */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Prompt del Sistema (Personalidad del Bot)
                    </label>
                    <textarea
                        value={config.system_prompt || ''}
                        onChange={(e) => handleChange('system_prompt', e.target.value)}
                        rows={15}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary focus:border-transparent font-mono text-sm"
                        placeholder="Instrucciones para el voicebot..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Define cómo debe comportarse el bot, su tono, objetivo y flujo de conversación. Este prompt controla completamente el comportamiento del voicebot.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default VoicebotConfig;
