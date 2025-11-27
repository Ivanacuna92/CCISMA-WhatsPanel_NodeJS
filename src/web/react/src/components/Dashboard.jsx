import React, { useState, useEffect } from 'react';
import { fetchStats, fetchDates } from '../services/api';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDates();
    loadStats();
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  const loadDates = async () => {
    try {
      const dates = await fetchDates();
      setAvailableDates(Array.isArray(dates) ? dates : []);
      // No auto-seleccionar fecha vieja, dejar que use "Hoy" por defecto
    } catch (error) {
      console.error('Error cargando fechas:', error);
    }
  };

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await fetchStats(selectedDate);
      setStats(data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-600">Cargando estadísticas...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-light text-navetec-primary">Panel de Control</h2>
        <select 
          value={selectedDate} 
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-4 py-2 rounded-md border border-gray-300 bg-white text-navetec-primary focus:outline-none focus:border-navetec-primary"
        >
          <option value="">Hoy</option>
          {availableDates.map(date => (
            <option key={date} value={date}>{date}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard
          title="Total Mensajes"
          value={stats?.totalMessages || 0}
        />
        <StatCard
          title="Usuarios Únicos"
          value={stats?.uniqueUsers || 0}
        />
        <StatCard
          title="Recibidos"
          value={stats?.userMessages || 0}
        />
        <StatCard
          title="Respuestas Bot"
          value={stats?.botMessages || 0}
        />
        <StatCard
          title="Errores"
          value={stats?.errors || 0}
        />
        <StatCard
          title="Promedio"
          value={`${stats?.averageResponseLength || 0} chars`}
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h3 className="text-xl font-light text-navetec-primary mb-6">Actividad por Hora</h3>
        <div className="flex items-end h-48 gap-1">
          {Object.entries(stats?.messagesByHour || {}).map(([hour, count]) => (
            <div key={hour} className="flex-1 flex flex-col items-center">
              <div 
                className="w-full bg-navetec-primary hover:bg-navetec-primary-dark transition-all"
                style={{ 
                  height: `${(count / Math.max(...Object.values(stats?.messagesByHour || {1: 1}))) * 100}%` 
                }}
              >
                <span className="text-white text-xs font-light flex justify-center pt-1">{count}</span>
              </div>
              <span className="text-xs text-gray-600 mt-1">{hour}h</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InsightCard
          title="HORA PICO"
          value={getPeakHour(stats?.messagesByHour)}
        />
        <InsightCard
          title="TASA DE RESPUESTA"
          value={`${calculateResponseRate(stats)}%`}
        />
        <InsightCard
          title="MENSAJES POR USUARIO"
          value={calculateMessagesPerUser(stats)}
        />
      </div>
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:border-navetec-primary transition-all">
      <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-2">{title}</h3>
      <p className="text-2xl font-light text-navetec-primary">{value}</p>
    </div>
  );
}

function InsightCard({ title, value }) {
  return (
    <div className="bg-navetec-primary rounded-lg text-white p-6">
      <h4 className="text-xs uppercase tracking-wider mb-2 opacity-70">{title}</h4>
      <p className="text-3xl font-light">{value}</p>
    </div>
  );
}

function getPeakHour(messagesByHour) {
  if (!messagesByHour || Object.keys(messagesByHour).length === 0) return 'N/A';
  const peak = Object.entries(messagesByHour).reduce((a, b) => 
    messagesByHour[a[0]] > messagesByHour[b[0]] ? a : b
  );
  return `${peak[0]}:00`;
}

function calculateResponseRate(stats) {
  if (!stats || !stats.userMessages) return 0;
  return Math.round((stats.botMessages / stats.userMessages) * 100);
}

function calculateMessagesPerUser(stats) {
  if (!stats || !stats.uniqueUsers) return 0;
  return (stats.totalMessages / stats.uniqueUsers).toFixed(1);
}

export default Dashboard;