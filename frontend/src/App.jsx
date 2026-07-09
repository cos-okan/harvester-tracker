import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { 
  Navigation, 
  User, 
  MapPin, 
  Gauge, 
  Droplet, 
  Calendar, 
  Search, 
  TrendingUp, 
  RotateCcw, 
  Map as MapIcon, 
  History, 
  CheckCircle, 
  AlertTriangle,
  FileText,
  Activity,
  Layers,
  ChevronRight
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || (window.location.port === "5173" ? `http://${window.location.hostname}:8010/api/v1/machines` : "/api/v1/machines");


// Helper to create dynamic custom SVG markers for harvesters
const getPulsingMarker = (isSpeeding) => {
  const colorClass = isSpeeding ? 'bg-red-500 border-red-300' : 'bg-emerald-500 border-emerald-300';
  const ringClass = isSpeeding ? 'animate-ping-slow text-red-500' : 'animate-pulse text-emerald-500';
  
  const html = `
    <div class="relative flex items-center justify-center w-9 h-9">
      <span class="absolute inline-flex h-full w-full rounded-full opacity-75 ${ringClass} bg-current"></span>
      <div class="relative flex items-center justify-center w-6.5 h-6.5 rounded-full ${colorClass} border-2 shadow-lg">
        <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 22h20L12 2z"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html: html,
    className: 'custom-harvester-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
  });
};

// Helper for smaller dot markers in trajectory history
const getHistoryMarker = (isSpeeding) => {
  const colorClass = isSpeeding ? 'bg-red-500 border-red-300' : 'bg-blue-500 border-blue-300';
  const html = `<div class="w-4 h-4 rounded-full ${colorClass} border-2 shadow-md transition-transform hover:scale-125"></div>`;
  return L.divIcon({
    html: html,
    className: 'custom-history-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
};

// Map helper component to fly to/pan to selected coordinates
function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom, {
        animate: true,
        duration: 1.5
      });
    }
  }, [center, zoom, map]);
  return null;
}

export default function App() {
  // App Tabs: 'live' or 'history'
  const [activeTab, setActiveTab] = useState('live');
  
  // Data States
  const [machines, setMachines] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  
  // Filtering states
  const [plateFilter, setPlateFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [areaCodeFilter, setAreaCodeFilter] = useState('');
  
  // History Date range filters (default to 2026-06-24 to 2026-06-26 as databases has records here)
  const [startDate, setStartDate] = useState('2026-06-24T00:00');
  const [endDate, setEndDate] = useState('2026-06-26T23:59');
  const [historyPlate, setHistoryPlate] = useState('');
  const [selectedHistoryPoint, setSelectedHistoryPoint] = useState(null);

  // UI States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mapCenter, setMapCenter] = useState([40.693378, 26.83737]); // Default to most recent harvester coordinates
  const [mapZoom, setMapZoom] = useState(13);
  
  // Timer ref for live updates polling
  const pollingInterval = useRef(null);
  const isInitialLoad = useRef(true);

  // Fetch Live Data
  const fetchLiveMachines = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (plateFilter) params.append('plate', plateFilter);
      if (driverFilter) params.append('driverTCKN', driverFilter);
      if (areaCodeFilter) params.append('areaCode', areaCodeFilter);

      const response = await fetch(`${API_BASE_URL}/live?${params.toString()}`);
      if (!response.ok) throw new Error('Canlı veri yüklenirken hata oluştu.');
      const data = await response.json();
      
      setMachines(data);
      
      if (data && data.length > 0) {
        if (isInitialLoad.current) {
          isInitialLoad.current = false;
          // Find the most recent machine
          const sorted = [...data].sort((a, b) => new Date(b.measurementDate) - new Date(a.measurementDate));
          const mostRecent = sorted[0];
          setSelectedMachine(mostRecent);
          const coords = mostRecent.location?.coordinates;
          if (coords && coords[0] !== 0 && coords[1] !== 0) {
            setMapCenter([coords[0], coords[1]]);
            setMapZoom(13);
          }
        } else if (selectedMachine) {
          // If a machine is selected, update its details with new data
          const updated = data.find(m => m.plate === selectedMachine.plate);
          if (updated) setSelectedMachine(updated);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Fetch History Data
  const fetchHistory = async () => {
    if (!historyPlate) {
      setError('Lütfen geçmiş izi çizmek için bir plaka seçin.');
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedHistoryPoint(null);
    try {
      const params = new URLSearchParams({
        plate: historyPlate,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      });
      
      const response = await fetch(`${API_BASE_URL}/history?${params.toString()}`);
      if (!response.ok) throw new Error('Geçmiş veri yüklenirken hata oluştu.');
      const data = await response.json();
      
      setHistoryData(data);
      
      if (data.length === 0) {
        setError('Belirtilen tarih aralığında bu plakaya ait kayıt bulunamadı.');
      } else {
        // Find first record with valid coordinates to center map
        const validCoords = data.find(d => d.location?.coordinates?.[0] > 0);
        if (validCoords) {
          setMapCenter([validCoords.location.coordinates[0], validCoords.location.coordinates[1]]);
          setMapZoom(13);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Set up polling for live mode
  useEffect(() => {
    if (activeTab === 'live') {
      fetchLiveMachines();
      
      if (autoRefresh) {
        pollingInterval.current = setInterval(() => {
          fetchLiveMachines(true);
        }, 10000); // Poll every 10 seconds
      }
    } else {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [activeTab, autoRefresh, plateFilter, driverFilter, areaCodeFilter]);

  // Handle switching tabs
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setError(null);
    setSelectedMachine(null);
    setSelectedHistoryPoint(null);
    
    if (tab === 'history') {
      // Pre-fill history plate with currently selected machine if any
      if (selectedMachine) {
        setHistoryPlate(selectedMachine.plate);
      } else if (machines.length > 0) {
        setHistoryPlate(machines[0].plate);
      }
      setHistoryData([]);
    } else {
      fetchLiveMachines();
    }
  };

  const handleMachineClick = (machine) => {
    setSelectedMachine(machine);
    const coords = machine.location?.coordinates;
    if (coords && coords[0] !== 0 && coords[1] !== 0) {
      setMapCenter([coords[0], coords[1]]);
      setMapZoom(14);
    }
  };

  const resetFilters = () => {
    setPlateFilter('');
    setDriverFilter('');
    setAreaCodeFilter('');
  };

  // Computed statistics
  const totalCount = machines.length;
  const speedingCount = machines.filter(m => m.isSpeeding).length;
  const activeCount = machines.filter(m => m.isActive).length;
  
  const avgSpeed = totalCount > 0 
    ? (machines.reduce((sum, m) => sum + (m.speed || 0), 0) / totalCount).toFixed(2)
    : 0;

  const avgHumidity = totalCount > 0 
    ? (machines.reduce((sum, m) => sum + (m.humidity || 0), 0) / totalCount).toFixed(1)
    : 0;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* Header */}
      <header className="glass-panel border-b border-slate-800/80 px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/30">
            <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white font-outfit">MEICOTT Biçerdöver Takip Sistemi</h1>
            <p className="text-xs text-slate-400">Canlı Telemetri ve Hız Sınır İhlal Yönetim MVP</p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => handleTabChange('live')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'live'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapIcon className="w-4 h-4" />
            Canlı Takip
          </button>
          <button
            onClick={() => handleTabChange('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTab === 'history'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            Geçmiş Rota İzleme
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar Controls */}
        <aside className="w-96 flex flex-col border-r border-slate-800/80 glass-panel z-10 shrink-0 overflow-y-auto">
          
          {/* Section: Live Controls & Filters */}
          {activeTab === 'live' ? (
            <div className="p-5 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-300 font-outfit tracking-wide uppercase">Filtreleme Paneli</span>
                <button 
                  onClick={resetFilters} 
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Sıfırla
                </button>
              </div>

              {/* Plate Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Plaka No</label>
                <div className="relative">
                  <input
                    type="text"
                    value={plateFilter}
                    onChange={(e) => setPlateFilter(e.target.value)}
                    placeholder="Örn: 59-002"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 transition-colors"
                  />
                  <Search className="w-4 h-4 text-slate-600 absolute left-3 top-3" />
                </div>
              </div>

              {/* TCKN Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Sürücü TCKN</label>
                <div className="relative">
                  <input
                    type="number"
                    value={driverFilter}
                    onChange={(e) => setDriverFilter(e.target.value)}
                    placeholder="11 haneli kimlik no"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 transition-colors"
                  />
                  <User className="w-4 h-4 text-slate-600 absolute left-3 top-3" />
                </div>
              </div>

              {/* Area Code Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Bölge Kodu</label>
                <select
                  value={areaCodeFilter}
                  onChange={(e) => setAreaCodeFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-700 transition-colors"
                >
                  <option value="">Tüm Bölgeler</option>
                  <option value="59">Tekirdağ (59)</option>
                  <option value="9">Aydın (9)</option>
                  <option value="35">İzmir (35)</option>
                </select>
              </div>

              {/* Refresh Info */}
              <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-xs font-semibold text-slate-300">Otomatik Güncelleme</span>
                </div>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={() => setAutoRefresh(!autoRefresh)}
                  className="rounded bg-slate-900 border-slate-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* Harvester List */}
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Biçerdöver Listesi ({machines.length})</span>
                  {loading && <span className="text-xs text-emerald-400 animate-pulse">Yükleniyor...</span>}
                </div>
                
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                  {machines.length === 0 ? (
                    <div className="text-center py-6 text-sm text-slate-500 border border-dashed border-slate-800 rounded-xl">
                      Biçerdöver bulunamadı.
                    </div>
                  ) : (
                    [...machines]
                      .sort((a, b) => new Date(b.measurementDate) - new Date(a.measurementDate))
                      .map((machine) => (
                        <div
                          key={machine._id}
                          onClick={() => handleMachineClick(machine)}
                          className={`p-3 rounded-xl cursor-pointer flex items-center justify-between border transition-all duration-300 ${
                            selectedMachine?.plate === machine.plate
                              ? 'bg-slate-800/90 border-slate-700 shadow'
                              : 'bg-slate-900/40 border-slate-800/60 hover:bg-slate-900/90 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-white text-sm font-outfit">{machine.plate}</span>
                            <span className="text-xs text-slate-400">{machine.areaName || 'Bilinmeyen'} ({machine.areaCode})</span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              Son Güncelleme: {new Date(machine.measurementDate).toLocaleString('tr-TR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${
                              machine.isSpeeding
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}>
                              {machine.speed.toFixed(1)} km/s
                            </span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Section: History Controls
            <div className="p-5 flex flex-col gap-5">
              <span className="text-sm font-bold text-slate-300 font-outfit tracking-wide uppercase">Rota Filtresi</span>
              
              {/* Select Machine */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Biçerdöver Plakası</label>
                <select
                  value={historyPlate}
                  onChange={(e) => setHistoryPlate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-700 transition-colors"
                >
                  <option value="">Plaka Seçin</option>
                  <option value="59-001">59-001</option>
                  <option value="59-002">59-002</option>
                  <option value="59-003">59-003</option>
                  <option value="59-004">59-004</option>
                  <option value="59-005">59-005</option>
                  <option value="09-0089">09-0089 (Aydın)</option>
                  <option value="09-0001">09-0001 (Aydın)</option>
                </select>
              </div>

              {/* Start Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Başlangıç Tarihi</label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-700 transition-colors"
                  />
                </div>
              </div>

              {/* End Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium">Bitiş Tarihi</label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-700 transition-colors"
                  />
                </div>
              </div>

              <button
                onClick={fetchHistory}
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-sm font-semibold rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    Rotayı Çiz
                  </>
                )}
              </button>

              {/* History points summary list */}
              {historyData.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Kayıt Noktaları ({historyData.length})</span>
                  <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                    {historyData.map((pt, idx) => (
                      <div
                        key={pt._id}
                        onClick={() => {
                          setSelectedHistoryPoint(pt);
                          if (pt.location?.coordinates?.[0] > 0) {
                            setMapCenter([pt.location.coordinates[0], pt.location.coordinates[1]]);
                            setMapZoom(15);
                          }
                        }}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${
                          selectedHistoryPoint?._id === pt._id
                            ? 'bg-slate-800 border-slate-700'
                            : 'bg-slate-900/40 border-slate-800 hover:bg-slate-900/90'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-slate-200">
                            {new Date(pt.measurementDate).toLocaleString('tr-TR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </span>
                          <span className="text-[10px] text-slate-500">Hız: {pt.speed} km/s | Nem: {pt.humidity ?? 0}%</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottom Branding / Statistics */}
          <div className="mt-auto p-5 border-t border-slate-800/80 bg-slate-950">
            {activeTab === 'live' && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Tüm Harvesterlar</span>
                  <span className="text-xl font-bold font-outfit text-white">{totalCount}</span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold text-red-400">Hız İhlali (&gt;7)</span>
                  <span className="text-xl font-bold font-outfit text-red-400 flex items-center gap-1.5">
                    {speedingCount}
                    {speedingCount > 0 && <span className="flex w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>}
                  </span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Ortalama Hız</span>
                  <span className="text-xl font-bold font-outfit text-emerald-400">{avgSpeed} <span className="text-[10px] text-slate-500 font-normal">km/s</span></span>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Ortalama Nem</span>
                  <span className="text-xl font-bold font-outfit text-blue-400">{avgHumidity}%</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>MEICOTT Agritech Ltd. © 2026</span>
              <span>v1.0.0-MVP</span>
            </div>
          </div>
        </aside>

        {/* Map Visualization & Detail Overlay */}
        <main className="flex-1 flex flex-col relative bg-slate-950 p-6 overflow-hidden">
          
          {/* Notifications / Errors */}
          {error && (
            <div className="absolute top-10 left-10 right-10 bg-red-950/80 border border-red-800 text-red-200 px-5 py-3.5 rounded-xl z-[1000] flex items-center gap-3 shadow-2xl backdrop-blur">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <span className="text-sm font-semibold">{error}</span>
            </div>
          )}

          {/* Leaflet Map */}
          <div className="flex-1 w-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative">
            <MapContainer 
              center={mapCenter} 
              zoom={mapZoom} 
              className="w-full h-full"
            >
              <LayersControl position="topright">
                <LayersControl.BaseLayer checked name="Uydu Haritası (Tarımsal)">
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Karanlık Harita">
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  />
                </LayersControl.BaseLayer>
              </LayersControl>
              
              <ChangeView center={mapCenter} zoom={mapZoom} />

              {/* Live Markers */}
              {activeTab === 'live' && machines.map((machine) => {
                const coords = machine.location?.coordinates;
                if (!coords || coords[0] === 0 || coords[1] === 0) return null;
                
                return (
                  <Marker
                    key={machine._id}
                    position={[coords[0], coords[1]]}
                    icon={getPulsingMarker(machine.isSpeeding)}
                    eventHandlers={{
                      click: () => {
                        setSelectedMachine(machine);
                      }
                    }}
                  >
                    <Popup>
                      <div className="text-xs p-1 text-slate-100 flex flex-col gap-1 min-w-[150px]">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                          <span className="font-bold text-sm text-white font-outfit">{machine.plate}</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                            machine.isSpeeding ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {machine.isSpeeding ? 'Aşırı Hız' : 'Normal Hız'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Gauge className="w-3.5 h-3.5 text-slate-400" />
                          <span>Hız: {machine.speed.toFixed(2)} km/s</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Droplet className="w-3.5 h-3.5 text-blue-400" />
                          <span>Nem: {machine.humidity ?? 'N/A'}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-red-400" />
                          <span className="truncate">{machine.areaName} ({machine.areaCode})</span>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* History Trajectory */}
              {activeTab === 'history' && historyData.length > 0 && (
                <>
                  {/* Draws the path */}
                  <Polyline
                    positions={historyData
                      .filter(d => d.location?.coordinates?.[0] > 0)
                      .map(d => [d.location.coordinates[0], d.location.coordinates[1]])
                    }
                    color="#3b82f6"
                    weight={4}
                    opacity={0.8}
                    dashArray="5, 10"
                  />
                  
                  {/* Markers along the path */}
                  {historyData
                    .filter(d => d.location?.coordinates?.[0] > 0)
                    .map((pt, idx) => {
                      const isSpeeding = pt.isSpeeding;
                      const coords = pt.location.coordinates;
                      
                      return (
                        <Marker
                          key={pt._id}
                          position={[coords[0], coords[1]]}
                          icon={getHistoryMarker(isSpeeding)}
                          eventHandlers={{
                            click: () => {
                              setSelectedHistoryPoint(pt);
                            }
                          }}
                        >
                          <Popup>
                            <div className="text-xs p-1 text-slate-100 flex flex-col gap-1 min-w-[160px]">
                              <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
                                <span className="font-bold text-white font-outfit">Nokta #{idx + 1}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  isSpeeding ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {isSpeeding ? 'Aşırı Hız' : 'Normal'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(pt.measurementDate).toLocaleString('tr-TR')}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                                <span>Hız: {pt.speed.toFixed(2)} km/s</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Droplet className="w-3.5 h-3.5 text-blue-400" />
                                <span>Nem: {pt.humidity ?? 'N/A'}%</span>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                </>
              )}
            </MapContainer>

            {/* Float Status Summary */}
            {activeTab === 'live' && machines.length > 0 && (
              <div className="absolute bottom-5 left-5 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur z-[1000] flex items-center gap-4 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  <span>Normal: {totalCount - speedingCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                  <span>Limit İhlali: {speedingCount}</span>
                </div>
              </div>
            )}
          </div>

          {/* Machine Details Drawer / Card Overlay */}
          {activeTab === 'live' && selectedMachine && (
            <div className="absolute top-10 right-10 w-80 glass-panel border border-slate-800/80 rounded-2xl shadow-2xl p-5 z-[1000] flex flex-col gap-4 animate-in slide-in-from-right duration-300">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-lg font-bold font-outfit text-white">{selectedMachine.plate}</h2>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Detay Paneli</span>
                </div>
                <button
                  onClick={() => setSelectedMachine(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Primary Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Gauge className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold">Anlık Hız</span>
                  </div>
                  <span className={`text-base font-bold font-outfit ${selectedMachine.isSpeeding ? 'text-red-400' : 'text-emerald-400'}`}>
                    {selectedMachine.speed.toFixed(2)} <span className="text-[9px] text-slate-500 font-normal">km/s</span>
                  </span>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Droplet className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-semibold">Nem Oranı</span>
                  </div>
                  <span className="text-base font-bold font-outfit text-blue-400">
                    {selectedMachine.humidity !== null ? `${selectedMachine.humidity}%` : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Nem Uygunluk Bildirimi */}
              {selectedMachine.humidity !== null && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 font-medium ${
                  selectedMachine.humidity <= 15
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {selectedMachine.humidity <= 15 ? (
                    <>
                      <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Hasat uygun nem koşullarında yapılıyor.</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>Nem yüksek, hasat koşulları uygun değil!</span>
                    </>
                  )}
                </div>
              )}

              {/* Sezonluk İstatistikler */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5 mb-0.5 text-slate-400 font-semibold uppercase tracking-wider text-[9px]">
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                  Genel İstatistikler
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ortalama Hız:</span>
                  <span className="font-semibold text-slate-200">
                    {selectedMachine.avgSpeed !== undefined && selectedMachine.avgSpeed !== null
                      ? `${selectedMachine.avgSpeed.toFixed(2)} km/s`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ortalama Nem:</span>
                  <span className="font-semibold text-slate-200">
                    {selectedMachine.avgHumidity !== undefined && selectedMachine.avgHumidity !== null
                      ? `%${selectedMachine.avgHumidity.toFixed(1)}`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Hız Aşım Adedi:</span>
                  <span className={`font-semibold ${selectedMachine.speedingCount > 0 ? 'text-red-400 font-bold' : 'text-slate-200'}`}>
                    {selectedMachine.speedingCount ?? 0} adet
                  </span>
                </div>
              </div>

              {/* Sürücü Bilgileri */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5 mb-0.5 text-slate-400 font-semibold uppercase tracking-wider text-[9px]">
                  <User className="w-3.5 h-3.5" />
                  Sürücü Detayları
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sürücü Kodu (ID):</span>
                  <span className="font-semibold text-slate-200">{selectedMachine.personId || 'Tanımsız'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sürücü TCKN:</span>
                  <span className="font-semibold text-slate-200">{selectedMachine.driverTCKN || 'Tanımsız'}</span>
                </div>
                <div className="flex justify-between border-t border-slate-900 pt-1.5 mt-0.5">
                  <span className="text-slate-500">Belge Durumu:</span>
                  <span className="font-semibold text-emerald-400">Operatör belgesine sahip sürücü</span>
                </div>
              </div>

              {/* Konum / Parsel Detayları */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5 mb-0.5 text-slate-400 font-semibold uppercase tracking-wider text-[9px]">
                  <MapPin className="w-3.5 h-3.5" />
                  Arazi & Parsel Bilgileri
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">İlçe / Bölge:</span>
                  <span className="font-semibold text-slate-200">{selectedMachine.areaName} ({selectedMachine.areaCode})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ada / Pafta / Parsel:</span>
                  <span className="font-semibold text-slate-200">
                    {selectedMachine.adaNo || '-'}/{selectedMachine.pafta || '-'}/{selectedMachine.parcelNo || '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Parsel Alanı:</span>
                  <span className="font-semibold text-slate-200">
                    {selectedMachine.parcelArea !== null ? `${selectedMachine.parcelArea.toLocaleString('tr-TR')} m²` : '-'}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-900 pt-1.5 mt-0.5">
                  <span className="text-slate-500">Ürün / Tohum:</span>
                  <span className="font-semibold text-teal-400">{selectedMachine.seedType || 'Belirtilmemiş'}</span>
                </div>
              </div>

              {/* Son Güncelleme Zamanı */}
              <div className="text-[10px] text-slate-500 flex items-center justify-between">
                <span>Son Güncelleme:</span>
                <span>
                  {new Date(selectedMachine.measurementDate).toLocaleString('tr-TR')}
                </span>
              </div>
            </div>
          )}

          {/* History Details Drawer / Card Overlay */}
          {activeTab === 'history' && selectedHistoryPoint && (
            <div className="absolute top-10 right-10 w-80 glass-panel border border-slate-800/80 rounded-2xl shadow-2xl p-5 z-[1000] flex flex-col gap-4 animate-in slide-in-from-right duration-300">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-lg font-bold font-outfit text-white">{historyPlate}</h2>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Geçmiş Konum Detayı</span>
                </div>
                <button
                  onClick={() => setSelectedHistoryPoint(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Point Date */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs flex flex-col gap-1">
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px] flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Ölçüm Zamanı
                </span>
                <span className="text-sm font-bold text-slate-200">
                  {new Date(selectedHistoryPoint.measurementDate).toLocaleString('tr-TR')}
                </span>
              </div>

              {/* Primary Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Gauge className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold">Hız</span>
                  </div>
                  <span className={`text-base font-bold font-outfit ${selectedHistoryPoint.isSpeeding ? 'text-red-400' : 'text-slate-200'}`}>
                    {selectedHistoryPoint.speed.toFixed(2)} <span className="text-[9px] text-slate-500 font-normal">km/s</span>
                  </span>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Droplet className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-semibold">Nem Oranı</span>
                  </div>
                  <span className="text-base font-bold font-outfit text-blue-400">
                    {selectedHistoryPoint.humidity !== null ? `${selectedHistoryPoint.humidity}%` : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Nem Uygunluk Bildirimi */}
              {selectedHistoryPoint.humidity !== null && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 font-medium ${
                  selectedHistoryPoint.humidity <= 15
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {selectedHistoryPoint.humidity <= 15 ? (
                    <>
                      <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Hasat uygun nem koşullarında yapılıyor.</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>Nem yüksek, hasat koşulları uygun değil!</span>
                    </>
                  )}
                </div>
              )}

              {/* Ürün / Tohum Bilgisi */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Ürün / Tohum Türü:</span>
                  <span className="font-semibold text-teal-400">{selectedHistoryPoint.seedType || 'Belirtilmemiş'}</span>
                </div>
              </div>

              {/* Location Coordinates */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5 text-xs">
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[9px] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Coğrafi Koordinatlar
                </span>
                <div className="flex justify-between font-mono mt-1 text-[11px] text-slate-300">
                  <span>Enlem (Lat):</span>
                  <span>{selectedHistoryPoint.location.coordinates[0].toFixed(6)}</span>
                </div>
                <div className="flex justify-between font-mono text-[11px] text-slate-300">
                  <span>Boylam (Lng):</span>
                  <span>{selectedHistoryPoint.location.coordinates[1].toFixed(6)}</span>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
