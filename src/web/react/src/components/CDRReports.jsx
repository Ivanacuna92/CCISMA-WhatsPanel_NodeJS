import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';

const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6'];

function CDRReports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('resumen');
  const [isConnected, setIsConnected] = useState(false);
  const [selectedCall, setSelectedCall] = useState(null);

  // Filtros para registros
  const [filters, setFilters] = useState({
    date: '',
    phone: '',
    limit: 50
  });
  const [filteredRecords, setFilteredRecords] = useState([]);

  useEffect(() => {
    fetchCDRData();
  }, []);

  useEffect(() => {
    if (data?.recentCalls) {
      applyFilters();
    }
  }, [data, filters]);

  const fetchCDRData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/cdr/stats', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Error al obtener datos del CDR');
      }

      const result = await response.json();
      setData(result);
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    if (!data?.recentCalls) return;

    let records = [...data.recentCalls];

    if (filters.date) {
      records = records.filter(r => r.date.startsWith(filters.date));
    }

    if (filters.phone) {
      records = records.filter(r => r.dst.includes(filters.phone));
    }

    setFilteredRecords(records.slice(0, filters.limit));
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0s';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const exportToCSV = () => {
    if (!data?.recentCalls) return;

    const headers = ['Fecha', 'Destino', 'Duracion (s)', 'Estado'];
    const csvContent = [
      headers.join(','),
      ...data.recentCalls.map(r => [
        formatDateTime(r.date),
        r.dst,
        r.duration,
        r.disposition
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `cdr_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadgeClass = (disposition) => {
    switch (disposition) {
      case 'ANSWERED':
        return 'bg-green-100 text-green-800';
      case 'NO ANSWER':
        return 'bg-yellow-100 text-yellow-800';
      case 'BUSY':
        return 'bg-orange-100 text-orange-800';
      case 'FAILED':
      case 'CONGESTION':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navetec-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-full">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="text-center py-12">
            <div className="text-red-500 text-lg mb-2">Error al cargar CDR</div>
            <div className="text-gray-500 text-sm mb-4">{error}</div>
            <button
              onClick={fetchCDRData}
              className="px-4 py-2 bg-navetec-primary text-white rounded-md hover:bg-navetec-primary-dark"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, firstCall, lastCall, callsByDay, callsByHour, dispositionStats } = data;

  // Calcular métricas adicionales
  const totalSeconds = summary.totalMinutes * 60;
  const totalHours = Math.round(summary.totalMinutes / 60 * 100) / 100;
  const shortestCall = data.shortestCall?.duration || 0;
  const longestCall = data.longestCall?.duration || 0;

  return (
    <div className="p-8 max-w-full overflow-auto">
      <div className="bg-white rounded-lg shadow-sm p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-light text-navetec-primary">Reportes CDR - Asterisk</h2>
            <p className="text-sm text-gray-500">Registro detallado de llamadas del sistema</p>
          </div>
          <div className="flex gap-2 items-center">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {isConnected ? 'Conectado' : 'Desconectado'}
            </span>
            <button
              onClick={fetchCDRData}
              className="px-4 py-2 bg-navetec-primary text-white rounded-md hover:bg-navetec-primary-dark transition-all"
            >
              Sincronizar
            </button>
            <button
              onClick={exportToCSV}
              className="px-4 py-2 bg-navetec-primary-dark text-white rounded-md hover:bg-navetec-secondary-4 transition-all"
            >
              Exportar CSV
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-8">
            <button
              onClick={() => setActiveTab('resumen')}
              className={`pb-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'resumen'
                  ? 'border-navetec-primary text-navetec-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Resumen
            </button>
            <button
              onClick={() => setActiveTab('registros')}
              className={`pb-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'registros'
                  ? 'border-navetec-primary text-navetec-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Registros
            </button>
          </nav>
        </div>

        {/* Tab Resumen */}
        {activeTab === 'resumen' && (
          <div className="space-y-6">
            {/* Métricas Principales */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Total Llamadas</div>
                <div className="text-3xl font-bold">{summary.totalCalls}</div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Contestadas</div>
                <div className="text-3xl font-bold">{summary.answeredCalls}</div>
                <div className="text-xs opacity-80">
                  {summary.totalCalls > 0 ? Math.round(summary.answeredCalls / summary.totalCalls * 100) : 0}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Minutos Totales</div>
                <div className="text-3xl font-bold">{summary.totalMinutes}</div>
              </div>
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Promedio</div>
                <div className="text-3xl font-bold">{formatDuration(summary.avgDuration)}</div>
              </div>
              <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Llamadas/Dia</div>
                <div className="text-3xl font-bold">{summary.callsPerDay}</div>
              </div>
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg p-4 text-white">
                <div className="text-xs opacity-80">Dias Activos</div>
                <div className="text-3xl font-bold">{summary.activeDays}</div>
              </div>
            </div>

            {/* Barra de Rango de Fechas */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-xs text-gray-500">Primera llamada</div>
                  <div className="text-sm font-medium text-gray-800">
                    {firstCall ? formatDateTime(firstCall.date) : '-'}
                  </div>
                  <div className="text-xs text-gray-500">{firstCall?.dst || '-'}</div>
                </div>
                <div className="text-2xl text-gray-300">→</div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Ultima llamada</div>
                  <div className="text-sm font-medium text-gray-800">
                    {lastCall ? formatDateTime(lastCall.date) : '-'}
                  </div>
                  <div className="text-xs text-gray-500">{lastCall?.dst || '-'}</div>
                </div>
              </div>
            </div>

            {/* Gráfica de Área - Llamadas por Día */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Llamadas por Dia</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={callsByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    fontSize={12}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getDate()}/${date.getMonth() + 1}`;
                    }}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip
                    labelFormatter={(value) => formatDateTime(value)}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Llamadas"
                    stroke="#3b82f6"
                    fill="#93c5fd"
                  />
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    name="Minutos"
                    stroke="#10b981"
                    fill="#6ee7b7"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Dos Gráficas lado a lado */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* BarChart - Distribución por Hora */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribucion por Hora</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={callsByHour.filter(h => h.hour >= 9 && h.hour <= 23)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      fontSize={10}
                      interval={2}
                      tickFormatter={(value) => `${value}h`}
                    />
                    <YAxis fontSize={10} />
                    <Tooltip
                      labelFormatter={(value) => `${value}:00 - ${value}:59`}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                    />
                    <Bar
                      dataKey="calls"
                      name="Llamadas"
                      fill="#8b5cf6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* PieChart - Estado de Llamadas */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Estado de Llamadas</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={dispositionStats}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {dispositionStats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Métricas Adicionales */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500">Segundos Totales</div>
                <div className="text-xl font-bold text-gray-800">{Math.round(totalSeconds)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500">Horas Totales</div>
                <div className="text-xl font-bold text-gray-800">{totalHours}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500">Llamada mas corta</div>
                <div className="text-xl font-bold text-gray-800">{formatDuration(shortestCall)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500">Llamada mas larga</div>
                <div className="text-xl font-bold text-gray-800">{formatDuration(longestCall)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Registros */}
        {activeTab === 'registros' && (
          <div>
            {/* Filtros */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={filters.date}
                    onChange={(e) => setFilters({ ...filters, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-navetec-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Telefono</label>
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={filters.phone}
                    onChange={(e) => setFilters({ ...filters, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-navetec-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Limite</label>
                  <select
                    value={filters.limit}
                    onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-navetec-primary"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">&nbsp;</label>
                  <button
                    onClick={applyFilters}
                    className="w-full px-3 py-2 bg-navetec-primary text-white rounded-md text-sm hover:bg-navetec-primary-dark transition-all"
                  >
                    Buscar
                  </button>
                </div>
              </div>
            </div>

            {/* Tabla */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Destino
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duracion
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                        No hay registros
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((call, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDateTime(call.date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {call.dst}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDuration(call.duration)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeClass(call.disposition)}`}>
                            {call.disposition}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => setSelectedCall(call)}
                            className="text-navetec-primary hover:text-navetec-primary-dark font-medium"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Contador */}
            <div className="mt-4 text-sm text-gray-500">
              {filteredRecords.length} registros
            </div>
          </div>
        )}
      </div>

      {/* Modal de Detalles */}
      {selectedCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Detalles de Llamada</h3>
              <button
                onClick={() => setSelectedCall(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Fecha</div>
                <div className="text-sm font-medium">{formatDateTime(selectedCall.date)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Destino</div>
                <div className="text-sm font-medium">{selectedCall.dst}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Duracion</div>
                <div className="text-sm font-medium">{formatDuration(selectedCall.duration)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Estado</div>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeClass(selectedCall.disposition)}`}>
                  {selectedCall.disposition}
                </span>
              </div>
              {selectedCall.channel && (
                <div className="bg-gray-50 p-3 rounded col-span-2">
                  <div className="text-xs text-gray-500">Canal</div>
                  <div className="text-sm font-mono">{selectedCall.channel}</div>
                </div>
              )}
              {selectedCall.uniqueid && (
                <div className="bg-gray-50 p-3 rounded col-span-2">
                  <div className="text-xs text-gray-500">UniqueID</div>
                  <div className="text-sm font-mono">{selectedCall.uniqueid}</div>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedCall(null)}
              className="w-full mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CDRReports;
