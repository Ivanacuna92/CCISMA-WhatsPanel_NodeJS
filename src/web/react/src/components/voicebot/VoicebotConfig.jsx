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
                        rows={8}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary focus:border-transparent font-mono text-sm"
                        placeholder="Instrucciones para el voicebot..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Define cómo debe comportarse el bot, su tono y objetivo en las conversaciones
                    </p>
                </div>

                {/* Configuraciones de OpenAI */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Modelo GPT
                        </label>
                        <select
                            value={config.gpt_model || 'gpt-4o'}
                            onChange={(e) => handleChange('gpt_model', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                        >
                            <option value="gpt-4o">GPT-4o (Recomendado)</option>
                            <option value="gpt-4o-mini">GPT-4o Mini (Más rápido)</option>
                            <option value="gpt-4">GPT-4</option>
                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Temperatura GPT
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={config.gpt_temperature || '0.7'}
                            onChange={(e) => handleChange('gpt_temperature', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                        />
                        <p className="text-xs text-gray-500 mt-1">0 = Conservador, 1 = Creativo</p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Voz TTS
                        </label>
                        <select
                            value={config.tts_voice || 'nova'}
                            onChange={(e) => handleChange('tts_voice', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                        >
                            <option value="alloy">Alloy (Neutral)</option>
                            <option value="echo">Echo (Masculina)</option>
                            <option value="fable">Fable (Femenina)</option>
                            <option value="onyx">Onyx (Masculina)</option>
                            <option value="nova">Nova (Femenina - Recomendada)</option>
                            <option value="shimmer">Shimmer (Femenina)</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Velocidad de Voz
                        </label>
                        <input
                            type="number"
                            min="0.25"
                            max="4"
                            step="0.05"
                            value={config.tts_speed || '1.2'}
                            onChange={(e) => handleChange('tts_speed', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                        />
                        <p className="text-xs text-gray-500 mt-1">1.0 = Normal, 1.2 = Recomendado</p>
                    </div>
                </div>

                {/* Configuraciones de Llamadas */}
                <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4">Configuración de Llamadas</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Duración Máxima (segundos)
                            </label>
                            <input
                                type="number"
                                min="60"
                                max="600"
                                value={config.max_call_duration || '300'}
                                onChange={(e) => handleChange('max_call_duration', e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Llamadas Concurrentes
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={config.concurrent_calls || '2'}
                                onChange={(e) => handleChange('concurrent_calls', e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Reintentos Máximos
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="5"
                                value={config.max_retries || '3'}
                                onChange={(e) => handleChange('max_retries', e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary"
                            />
                        </div>
                    </div>
                </div>

                {/* Grabación */}
                <div className="border-t pt-6">
                    <h3 className="text-lg font-semibold mb-4">Grabación de Llamadas</h3>
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="recording_enabled"
                            checked={config.recording_enabled === '1' || config.recording_enabled === true}
                            onChange={(e) => handleChange('recording_enabled', e.target.checked ? '1' : '0')}
                            className="h-5 w-5 text-navetec-primary focus:ring-navetec-primary border-gray-300 rounded"
                        />
                        <label htmlFor="recording_enabled" className="ml-3 text-sm text-gray-700">
                            Habilitar grabación de todas las llamadas
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default VoicebotConfig;
