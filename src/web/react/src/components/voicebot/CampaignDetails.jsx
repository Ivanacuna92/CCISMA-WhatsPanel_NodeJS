import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Pause, Square, Phone, Users, Clock, Loader2 } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function CampaignDetails({ campaign: initialCampaign, onBack, onUpdate }) {
    const [campaign, setCampaign] = useState(initialCampaign);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    // Función para obtener datos actualizados de la campaña
    const fetchCampaignData = async () => {
        try {
            const [campaignData, statsData] = await Promise.all([
                voicebotApi.getCampaign(campaign.id),
                voicebotApi.getCampaignStats(campaign.id)
            ]);
            setCampaign(campaignData);
            setStats(statsData);
        } catch (error) {
            console.error('Error cargando datos de campaña:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCampaignData();
        // Actualizar cada 2 segundos para tiempo real
        const interval = setInterval(fetchCampaignData, 2000);
        return () => clearInterval(interval);
    }, [initialCampaign.id]);

    const handleStart = async () => {
        setActionLoading(true);
        try {
            await voicebotApi.startCampaign(campaign.id);
            // Actualizar estado local inmediatamente
            setCampaign(prev => ({ ...prev, status: 'running' }));
            await onUpdate();
        } catch (error) {
            console.error('Error iniciando campaña:', error);
            alert(error.response?.data?.error || 'Error iniciando campaña');
        } finally {
            setActionLoading(false);
        }
    };

    const handlePause = async () => {
        setActionLoading(true);
        try {
            await voicebotApi.pauseCampaign(campaign.id);
            // Actualizar estado local inmediatamente
            setCampaign(prev => ({ ...prev, status: 'paused' }));
            await onUpdate();
        } catch (error) {
            console.error('Error pausando campaña:', error);
            alert(error.response?.data?.error || 'Error pausando campaña');
        } finally {
            setActionLoading(false);
        }
    };

    const handleStop = async () => {
        if (!confirm('¿Estás seguro de detener esta campaña?')) return;

        setActionLoading(true);
        try {
            await voicebotApi.stopCampaign(campaign.id);
            // Actualizar estado local inmediatamente
            setCampaign(prev => ({ ...prev, status: 'completed' }));
            await onUpdate();
            onBack();
        } catch (error) {
            console.error('Error deteniendo campaña:', error);
            alert(error.response?.data?.error || 'Error deteniendo campaña');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div>Cargando...</div>;
    }

    const progress = stats?.total_contacts_loaded > 0
        ? Math.round((stats.calls_completed / stats.total_contacts_loaded) * 100)
        : 0;

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <button
                    onClick={onBack}
                    className="flex items-center text-gray-600 hover:text-gray-800"
                >
                    <ArrowLeft className="h-5 w-5 mr-2" />
                    Volver
                </button>

                <div className="flex space-x-2">
                    {campaign.status === 'pending' && (
                        <button
                            onClick={handleStart}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            {actionLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Iniciando...
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Iniciar Campaña
                                </>
                            )}
                        </button>
                    )}

                    {campaign.status === 'running' && (
                        <button
                            onClick={handlePause}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            {actionLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Pausando...
                                </>
                            ) : (
                                <>
                                    <Pause className="h-4 w-4 mr-2" />
                                    Pausar
                                </>
                            )}
                        </button>
                    )}

                    {campaign.status === 'paused' && (
                        <button
                            onClick={handleStart}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            {actionLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Reanudando...
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Reanudar
                                </>
                            )}
                        </button>
                    )}

                    {(campaign.status === 'running' || campaign.status === 'paused') && (
                        <button
                            onClick={handleStop}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            {actionLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deteniendo...
                                </>
                            ) : (
                                <>
                                    <Square className="h-4 w-4 mr-2" />
                                    Detener
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Campaign Info */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-2xl font-bold text-gray-800">{campaign.campaign_name}</h1>
                    {/* Etiqueta de estado en tiempo real */}
                    <span className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center ${
                        campaign.status === 'running'
                            ? 'bg-green-100 text-green-700'
                            : campaign.status === 'paused'
                            ? 'bg-yellow-100 text-yellow-700'
                            : campaign.status === 'completed'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-700'
                    }`}>
                        {campaign.status === 'running' && (
                            <span className="relative flex h-3 w-3 mr-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                        )}
                        {campaign.status === 'running' ? 'En ejecución'
                            : campaign.status === 'paused' ? 'Pausada'
                            : campaign.status === 'completed' ? 'Completada'
                            : 'Pendiente'}
                    </span>
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                        <span>Progreso de llamadas</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                            className="bg-navetec-primary h-3 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Users className="h-5 w-5 text-blue-600 mr-2" />
                            <span className="text-sm text-gray-600">Total Contactos</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-900">{stats?.total_contacts_loaded || 0}</p>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Phone className="h-5 w-5 text-green-600 mr-2" />
                            <span className="text-sm text-gray-600">Completadas</span>
                        </div>
                        <p className="text-2xl font-bold text-green-900">{stats?.calls_completed || 0}</p>
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Clock className="h-5 w-5 text-yellow-600 mr-2" />
                            <span className="text-sm text-gray-600">Pendientes</span>
                        </div>
                        <p className="text-2xl font-bold text-yellow-900">{stats?.calls_pending || 0}</p>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Phone className="h-5 w-5 text-purple-600 mr-2" />
                            <span className="text-sm text-gray-600">Citas</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-900">{stats?.appointments_scheduled || 0}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CampaignDetails;
