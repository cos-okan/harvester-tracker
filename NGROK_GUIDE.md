# Ngrok ile Dış Dünyadan Erişime Açma Kılavuzu

Bu kılavuz, yerel geliştirme veya test ortamınızda Docker üzerinde çalışan **MEICOTT Biçerdöver Takip Sistemi** uygulamasını `ngrok` kullanarak dış dünyadan güvenli bir şekilde nasıl erişilebilir hale getireceğinizi adım adım açıklamaktadır.

---

## 🛠 Neden Kolay? (Tek Port Mimarisi)

Projede uygulanan **Nginx Reverse Proxy** konfigürasyonu sayesinde:
* Hem **Frontend** (React web arayüzü) hem de **Backend API** (FastAPI) servisleri tek bir port (**Port 80**) üzerinden sunulmaktadır.
* `/api/...` ile başlayan tüm istekler arka planda otomatik olarak backend servisine yönlendirilir.
* Bu durum, ngrok ile dış dünyaya açılırken birden fazla tünel kurma karmaşasını ve tarayıcılardaki **CORS (Cross-Origin Resource Sharing)** güvenlik hatalarını tamamen ortadan kaldırır. Sadece **Port 80**'i tünellemeniz yeterlidir.

---

## 🚀 Adım Adım Ngrok Kurulumu ve Çalıştırılması

### Adım 1: Ngrok Kurulumu

Ngrok'u işletim sisteminize göre aşağıdaki yöntemlerden biriyle kurun:

* **macOS (Homebrew ile):**
  ```bash
  brew install ngrok
  ```
* **Linux (Debian/Ubuntu):**
  ```bash
  curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
    | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
    && echo "deb https://ngrok-agent.s3.amazonaws.com/bz2/debian alldev main" \
    | sudo tee /etc/apt/sources.list.d/ngrok.list \
    && sudo apt update \
    && sudo apt install ngrok
  ```
* **Windows (Chocolatey veya Manuel):**
  ```powershell
  choco install ngrok
  ```
  Veya [ngrok.com](https://ngrok.com/download) adresinden zip dosyasını indirip kurabilirsiniz.

---

### Adım 2: Ngrok Hesabınızı Eşleştirin (Auth Token)

Ngrok tünellerini başlatabilmek için bir ngrok hesabına ihtiyacınız vardır. Hesabınız yoksa [ngrok.com](https://ngrok.com/) adresinden ücretsiz bir hesap oluşturun.

Ardından [ngrok Dashboard](https://dashboard.ngrok.com/) ekranından alacağınız **Authtoken** bilgisini terminalde şu komutla kaydedin:

```bash
ngrok config add-authtoken <SENIN_NGROK_AUTHTOKEN_BILGIN>
```

---

### Adım 3: Tüneli Başlatın

Projenin Docker üzerinde çalıştığından emin olun (`docker compose ps` ile kontrol edebilirsiniz). Docker servisleri port 80 üzerinden hizmet verdiği için terminalde aşağıdaki komutu çalıştırarak tüneli başlatın:

```bash
ngrok http 80
```

Komutu çalıştırdıktan sonra terminalde şöyle bir ekran görüntülenecektir:

```text
Session Status                online
Account                       Adınız Soyadınız (User ID)
Version                       3.x.x
Region                        Europe (eu)
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://a1b2-34-56-78-90.ngrok-free.app -> http://localhost:80
```

---

### Adım 4: Erişim Sağlayın ve Test Edin

Terminaldeki `Forwarding` satırında yazan adresi (`https://xxxx.ngrok-free.app` benzeri olan) kopyalayın:

1. **Web Arayüzü**: Bu URL'i herhangi bir internet tarayıcısında (bilgisayarınızda veya mobil cihazınızda) açarak canlı haritayı ve paneli görüntüleyebilirsiniz.
2. **API Dokümantasyonu (Swagger)**: API uç noktalarını incelemek için URL'in sonuna `/docs` ekleyerek erişebilirsiniz (örn: `https://xxxx.ngrok-free.app/docs`).
3. **Canlı Telemetri API**: `https://xxxx.ngrok-free.app/api/v1/machines/live` adresine giderek MongoDB'den gelen canlı verileri doğrudan JSON formatında görebilirsiniz.
