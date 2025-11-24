import React, { useState, useEffect } from 'react';
import { Calendar, User, Phone, MapPin, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function AppointmentsList() {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, high, medium, low
    const [campaigns, setCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState('all');

    useEffect(() => {
        loadCampaigns();
        loadAppointments();
        // Actualizar cada 30 segundos
        const interval = setInterval(loadAppointments, 30000);
        return () => clearInterval(interval);
    }, [selectedCampaign]);

    const loadCampaigns = async () => {
        try {
            const campaigns = await voicebotApi.getCampaigns();
            setCampaigns(campaigns || []);
        } catch (error) {
            console.error('Error cargando campañas:', error);
        }
    };

    const loadAppointments = async () => {
        try {
            setLoading(true);
            let appointments;
            if (selectedCampaign === 'all') {
                appointments = await voicebotApi.getAllAppointments();
            } else {
                appointments = await voicebotApi.getCampaignAppointments(selectedCampaign);
            }
            setAppointments(appointments || []);
        } catch (error) {
            console.error('Error cargando citas:', error);
            setAppointments([]);
        } finally {
            setLoading(false);
        }
    };

    const getInterestColor = (level) => {
        switch (level) {
            case 'high': return 'text-green-600 bg-green-100';
            case 'medium': return 'text-yellow-600 bg-yellow-100';
            case 'low': return 'text-gray-600 bg-gray-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    const getInterestLabel = (level) => {
        switch (level) {
            case 'high': return 'Alto Interés';
            case 'medium': return 'Interés Medio';
            case 'low': return 'Interés Bajo';
            default: return 'Sin Definir';
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Por confirmar';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-MX', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const filteredAppointments = appointments.filter(apt => {
        if (filter === 'all') return true;
        return apt.interest_level === filter;
    });

    const stats = {
        total: appointments.length,
        high: appointments.filter(a => a.interest_level === 'high').length,
        medium: appointments.filter(a => a.interest_level === 'medium').length,
        low: appointments.filter(a => a.interest_level === 'low').length,
        agreements: appointments.filter(a => a.agreement_reached).length
    };

    if (loading && appointments.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-8 w-8 text-navetec-primary animate-spin mr-3" />
                    <span className="text-gray-600">Cargando citas agendadas...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow">
            {/* Header con Stats */}
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">
                        Citas Agendadas
                    </h2>
                    <button
                        onClick={loadAppointments}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-600 hover:text-navetec-primary border border-gray-300 rounded-md hover:border-navetec-primary transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        <span>Actualizar</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-5 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <Calendar className="h-8 w-8 text-blue-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
                                <div className="text-xs text-blue-600">Total Citas</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-green-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-green-600">{stats.high}</div>
                                <div className="text-xs text-green-600">Alto Interés</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-yellow-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-yellow-600">{stats.medium}</div>
                                <div className="text-xs text-yellow-600">Interés Medio</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-gray-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-gray-600">{stats.low}</div>
                                <div className="text-xs text-gray-600">Interés Bajo</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <CheckCircle className="h-8 w-8 text-purple-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-purple-600">{stats.agreements}</div>
                                <div className="text-xs text-purple-600">Acuerdos</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filtros */}
                <div className="flex items-center space-x-4">
                    {/* Filtro por campaña */}
                    <select
                        value={selectedCampaign}
                        onChange={(e) => setSelectedCampaign(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                    >
                        <option value="all">Todas las campañas</option>
                        {campaigns.map(campaign => (
                            <option key={campaign.id} value={campaign.id}>
                                {campaign.campaign_name}
                            </option>
                        ))}
                    </select>

                    {/* Filtro por interés */}
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'all'
                                    ? 'bg-navetec-primary text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Todas ({stats.total})
                        </button>
                        <button
                            onClick={() => setFilter('high')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'high'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-green-100 text-green-600 hover:bg-green-200'
                            }`}
                        >
                            Alto ({stats.high})
                        </button>
                        <button
                            onClick={() => setFilter('medium')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'medium'
                                    ? 'bg-yellow-600 text-white'
                                    : 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                            }`}
                        >
                            Medio ({stats.medium})
                        </button>
                        <button
                            onClick={() => setFilter('low')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'low'
                                    ? 'bg-gray-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Bajo ({stats.low})
                        </button>
                    </div>
                </div>
            </div>

            {/* Lista de Citas */}
            <div className="divide-y divide-gray-200">
                {filteredAppointments.length === 0 ? (
                    <div className="p-12 text-center">
                        <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg mb-2">No hay citas agendadas</p>
                        <p className="text-gray-400 text-sm">
                            {filter !== 'all'
                                ? 'Prueba con otro filtro'
                                : 'Las citas aparecerán aquí cuando el voicebot complete llamadas exitosas'
                            }
                        </p>
                    </div>
                ) : (
                    filteredAppointments.map((appointment) => (
                        <div key={appointment.id} className="p-6 hover:bg-gray-50 transition-colors">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center space-x-3 mb-3">
                                        <h3 className="text-lg font-semibold text-gray-900">
                                            {appointment.client_name}
                                        </h3>
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getInterestColor(appointment.interest_level)}`}>
                                            {getInterestLabel(appointment.interest_level)}
                                        </span>
                                        {appointment.agreement_reached && (
                                            <span className="px-3 py-1 rounded-full text-xs font-medium text-green-600 bg-green-100 flex items-center space-x-1">
                                                <CheckCircle className="h-3 w-3" />
                                                <span>Acuerdo Alcanzado</span>
                                            </span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mb-3">
                                        <div className="flex items-center text-sm text-gray-600">
                                            <Phone className="h-4 w-4 mr-2 text-gray-400" />
                                            <span>{appointment.phone_number}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600">
                                            <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                            <span>{formatDate(appointment.appointment_date)}</span>
                                            {appointment.appointment_date && (
                                                <span className="ml-2 text-navetec-primary font-medium">
                                                    {formatTime(appointment.appointment_date)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600">
                                            <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                                            <span>{appointment.nave_location || 'Sin ubicación'}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600">
                                            <Clock className="h-4 w-4 mr-2 text-gray-400" />
                                            <span>
                                                Llamada: {new Date(appointment.call_start).toLocaleDateString('es-MX')} -
                                                {' '}{appointment.duration_seconds}s
                                            </span>
                                        </div>
                                    </div>

                                    {/* Información de la nave */}
                                    {(appointment.nave_type || appointment.nave_size || appointment.nave_price) && (
                                        <div className="bg-gray-50 rounded-lg p-3 mb-3">
                                            <div className="text-xs font-medium text-gray-500 mb-1">Detalles de la Nave:</div>
                                            <div className="grid grid-cols-3 gap-2 text-sm">
                                                {appointment.nave_type && (
                                                    <div>
                                                        <span className="text-gray-500">Tipo:</span>{' '}
                                                        <span className="font-medium">{appointment.nave_type}</span>
                                                    </div>
                                                )}
                                                {appointment.nave_size && (
                                                    <div>
                                                        <span className="text-gray-500">Tamaño:</span>{' '}
                                                        <span className="font-medium">{appointment.nave_size} m²</span>
                                                    </div>
                                                )}
                                                {appointment.nave_price && (
                                                    <div>
                                                        <span className="text-gray-500">Precio:</span>{' '}
                                                        <span className="font-medium">${appointment.nave_price}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Notas del análisis */}
                                    {appointment.analysis_notes && (
                                        <div className="bg-blue-50 rounded-lg p-3">
                                            <div className="text-xs font-medium text-blue-700 mb-1">
                                                Análisis de la conversación:
                                            </div>
                                            <p className="text-sm text-blue-900">{appointment.analysis_notes}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Campaña */}
                                <div className="ml-6 text-right">
                                    <div className="text-xs text-gray-500 mb-1">Campaña</div>
                                    <div className="text-sm font-medium text-gray-700">
                                        {appointment.campaign_name}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default AppointmentsList;
