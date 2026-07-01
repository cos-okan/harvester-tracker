# MEICOTT - Biçerdöver Takip ve Hız Sınır Yönetim Sistemi (MVP)

Tarımsal biçerdöverlerin anlık konumlarını, hız ihlallerini (%7 km/s sınırını), nem oranlarını ve tarihsel çalışma rotalarını izleyen, aynı zamanda yeni verileri otomatik olarak dış sistemlere (Bakanlık vb.) yönlendiren bir MVP (Minimum Uygulanabilir Ürün) yazılımıdır.

---

## 🛠 Kullanılan Teknolojiler (Tech Stack)

* **Backend:** FastAPI (Python), Motor (MongoDB Asenkron Sürücüsü), Pydantic v2
* **Frontend:** React.js, Vite, Tailwind CSS, Leaflet.js (Harita görselleştirme için)
* **Veritabanı:** MongoDB (Remote Standalone Server)
* **Konteynerleştirme:** Docker & Docker Compose

---

## 📂 Proje Dizin Yapısı

```text
harvester-tracker/
├── docker-compose.yml        # Docker orkestrasyon dosyası
├── backend/
│   ├── app/
│   │   ├── config.py         # Çevre değişkenleri ve ayarlar
│   │   ├── db.py             # Asenkron MongoDB bağlantı yönetimi
│   │   ├── forwarder.py      # Asenkron veri yönlendirme (Webhook) servisi
│   │   ├── main.py           # FastAPI başlangıç dosyası
│   │   ├── models.py         # Pydantic veri modelleri
│   │   └── routes.py         # Canlı durum, geçmiş ve test endpointleri
│   ├── .env                  # Çevre değişkenleri dosyası
│   ├── Dockerfile            # Python backend imaj tarifi
│   └── requirements.txt      # Python bağımlılıkları listesi
└── frontend/
    ├── src/
    │   ├── App.jsx           # Ana Dashboard ve Leaflet harita uygulaması
    │   ├── index.css         # Glassmorphic tasarımlar ve animasyonlar
    │   └── main.jsx          # React başlangıç noktası
    ├── Dockerfile            # Nginx tabanlı frontend imaj tarifi
    ├── nginx.conf            # Nginx yönlendirme ayarları
    └── package.json          # Node.js bağımlılıkları
```

---

## 🚀 Canlı Sunucuya Deploy Etme Kılavuzu (Docker ile)

Uzak sunucuda (örn: Ubuntu VPS) uygulamayı yayına almak için aşağıdaki adımları izleyin:

### 1. Ön Gereksinimler
Sunucunuzda Docker ve Docker Compose kurulu olmalıdır. Kurulu değilse:
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
```

### 2. Projeyi Klonlayın
```bash
cd /var/www
git clone git@github.com:cos-okan/harvester-tracker.git
cd harvester-tracker
```

### 3. Çevre Değişkenlerini (`.env`) Yapılandırın
Uygulama ayarlarını değiştirmek için `backend/.env` dosyasını düzenleyin:
```bash
nano backend/.env
```
Gerekli alanları doldurun:
```env
# Canlı MongoDB bağlantı adresi
MONGO_URL=mongodb://94.130.179.94:27017
DATABASE_NAME=meicottReportDB

# Bakanlık/Dış sistemin size verdiği gerçek canlı API adresi
FORWARD_URL=https://api.bakanlik-sistemi.gov.tr/v1/telemetry

SPEED_LIMIT=7.0
PORT=8010
HOST=0.0.0.0
```

### 4. Konteynerleri Başlatın
Proje ana dizinindeyken (`docker-compose.yml` dosyasının olduğu yerde) şu komutla her şeyi ayağa kaldırın:
```bash
docker compose up --build -d
```
Konteynerlerin çalıştığını teyit edin:
```bash
docker compose ps
```

---

## 📡 API Uç Noktaları (Endpoints)

FastAPI otomatik dokümantasyonuna sunucunuzun **8010** portundan erişebilirsiniz:
* **Swagger UI:** `http://localhost:8010/docs`
* **ReDoc:** `http://localhost:8010/redoc`

### Ana Servisler:
1. **Canlı Takip API (GET `/api/v1/machines/live`):**
   Makinelerin en son telemetri durumlarını döndürür. `plate`, `driverTCKN` ve `areaCode` query filtrelerini destekler.
2. **Tarihsel İz API (GET `/api/v1/machines/history`):**
   Belirli bir plaka ve zaman aralığındaki konum verilerini kronolojik sırada getirir.
3. **Veri Yönlendirme Servisi (Background Data Forwarder):**
   MongoDB'de `forward_state` koleksiyonu ile iletilen son kaydı izleyerek, yeni veri geldikçe otomatik olarak `.env` içindeki `FORWARD_URL` adresine HTTP POST ile veri iletir.

---

## 🖥 Yerel Geliştirme Ortamında Çalıştırma (Docker Olmadan)

### Backend'i Başlatma:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

### Frontend'i Başlatma:
```bash
cd frontend
npm install
npm run dev
```
Geliştirme arayüzüne `http://localhost:5173` üzerinden erişebilirsiniz.

---

## 🌐 Dış Dünyadan Erişim (Ngrok)

Uygulamayı local ortamınızdayken ngrok yardımıyla dış dünyaya açmak için hazırlanan detaylı kılavuza [NGROK_GUIDE.md](NGROK_GUIDE.md) dosyasından ulaşabilirsiniz.
