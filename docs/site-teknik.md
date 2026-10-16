# IP Tools — teknik föy

Küçük işletmeler ve ev kullanıcıları için "kendi yerel ağımda ne var?" aracı. Kayıtlı IP aralıklarını tarar; bulunan
cihazların adını, MAC adresini, üreticisini, yanıt süresini ve açık servislerini listeler. Yalnız **keşif ve envanter**
yapar; tasarım gereği bunun ötesine geçmez (bkz. *Bilinen sınırlar*). Mastertool ailesinin **Araçlar** grubundandır.

- Tanıtım: https://mastertool.download/araclar/ip-tools
- İndirme: Hesabım (mastertool.download) ve Master Tool
- Uygulama kodu: `ip` · Kaynak: github.com/goktalay/iptools

## Gereksinimler

| | |
| --- | --- |
| İşletim sistemi | Windows 10 / 11 (64 bit) |
| Yönetici izni | Gerekmez (kurulum için de "yalnız bu kullanıcı" seçeneği vardır) |
| Hesap | Mastertool hesabı (ücretsiz); tek girişle ailenin diğer uygulamaları da açılır |
| Ağ | Yerel ağ; internet yalnız hesap, senkron ve güncelleme denetimi için |
| Disk | ~90 MB |

Kurulum: `IP-Tools-Setup-<sürüm>.exe` → `Program Files\Mastertool\IP Tools` (Başlat menüsü: **Master Tool › IP Tools**).
Taşınabilir sürüm: `IP-Tools-Portable-<sürüm>.exe` (kurulum gerektirmez; ayarlar `%APPDATA%\ip-tools` altında).

## Teknoloji

- **Electron 33** (Chromium + Node.js), tek `main.js` süreci ve yalıtılmış pencereler (`contextIsolation`, `nodeIntegration: false`,
  CSP). Paketleme **electron-builder** NSIS (kurulum + portable), ortak `build/installer.nsh` (Mastertool klasörü, eski konumdan taşıma).
- Dış bağımlılık yalnız `@napi-rs/keyring` (Windows Kimlik Bilgisi Yöneticisi; ortak oturum). Ağ işlemleri Node'un `net`,
  `tls`, `dns`, `dgram` ve `child_process` modülleriyle; üçüncü parti tarama kütüphanesi yoktur.
- **8 dil**: Türkçe, English, Français, Deutsch, Español, العربية (sağdan sola), 中文, Русский. Tema: Gece / Gündüz / Sistem.
- **Hesap ve senkron** (mastertool.download, `/api/ip/*`): kayıtlar, klasörler ve ayarlar uçtan uca şifreli
  (PBKDF2 → HKDF `ipt-enc-v1` → AES-256-GCM); sunucu içeriği okuyamaz. **Tarama sonuçları hiçbir zaman gönderilmez**;
  yalnız bu bilgisayarda (`%APPDATA%\ip-tools\scans\`) saklanır.
- **Ortak oturum (SSO)**: `Entry('Mastertool','sso')` + `%APPDATA%\Mastertool\sso-state.json`; goktalay/mastertool `src/sso.js` ile birebir.
- Sürüm denetimi: `GET /api/ip/releases/latest`; yeni sürüm bildirimi, indirme Hesabım/Master Tool'dan.

## Tarama yöntemi

Tarama üç aşamadan oluşur ve her an **Durdur** ile kesilebilir:

1. **Canlılık** — İşletim sisteminin kendi `ping` aracı çocuk süreç olarak çalıştırılır (`ping -n 1 -w <ms>`); ham soket
   açılmaz, yönetici izni gerekmez. Ardından ARP tablosu okunur (`arp -a`): ping'e yanıt vermeyen ama tabloda görünen
   cihazlar da canlı sayılır ve MAC adresleri buradan alınır.
2. **Servisler** — Yalnız canlı cihazlara, aşağıdaki **sabit** port listesine standart bir TCP bağlantı denemesi yapılır
   (bağlandı / bağlanamadı). Bağlantı açılınca en çok şu yapılır:
   - *karşılama*: sunucunun kendiliğinden gönderdiği ilk satır okunur (SSH, FTP, VNC); biz hiçbir şey göndermeyiz;
   - *http*: tek bir `GET /` isteği; yalnız `<title>` ve `Server` başlığı alınır (2 sn);
   - *tls*: TLS el sıkışması; yalnız sunucunun sunduğu sertifikanın konu adı, kuruluşu, vereni ve son tarihi okunur, sonra `GET /`;
   - *hiçbiri*: yazıcı ham portu (9100), RDP, SMB, veritabanları ve RTSP'ye **hiçbir bayt yazılmaz**; bağlantı kurulur kurulmaz kapatılır.
3. **Adlar** — İşletim sisteminin ters DNS'i (`dns.reverse`) ve cihazın kendisine gönderilen tek bir mDNS PTR sorgusu
   (5353/udp, tek noktaya yanıt). MAC üreticisi gömülü IEEE OUI (MA-L) tablosundan (`src/data/oui.tsv.gz`, ~40.000 kayıt;
   `npm run oui` ile güncellenir). Rastgele ("özel") Wi-Fi adreslerinin üreticisi yoktur, "özel adres" olarak gösterilir.

**Hız sınırları (tasarım gereği):** en çok **64** eşzamanlı iş (ping + bağlantı denemeleri ortak havuz), cihaz başına en
çok **1 sn** zaman aşımı, aynı kayıt en erken **30 sn** sonra yeniden taranır. Bir /24 tipik olarak 5–10 sn sürer.

**Taranabilir adresler:** yalnız RFC 1918 (10/8, 172.16/12, 192.168/16) ve bağlantı-yerel (169.254/16). Başka bir adres
içeren kayıt **kaydedilmez** ve açıklamalı hata gösterilir. En geniş aralık /16 (65.536 adres). Aralık biçimleri:
`192.168.1.1-192.168.1.255`, `192.168.1.1-255`, `192.168.1.0/24`, tek IP; virgülle birden çok.

## Port listesi

Liste sabittir; Ayarlar › Tarama'dan yalnız **kapatılabilir**, genişletilemez.

| Port | Servis | Etiket grubu | Bağlantı açılınca | Etiket tıklanınca |
| --- | --- | --- | --- | --- |
| 80 | HTTP | Web | `GET /` → başlık, Server | Tarayıcıda `http://ip/` |
| 443 | HTTPS | Web | TLS sertifika konusu + `GET /` | Tarayıcıda `https://ip/` |
| 8080 | HTTP | Web | `GET /` | Tarayıcıda `http://ip:8080/` |
| 8443 | HTTPS | Web | TLS + `GET /` | Tarayıcıda `https://ip:8443/` |
| 22 | SSH | SSH | karşılama satırı | Adresi kopyala (`ssh ip`) |
| 21 | FTP | FTP | karşılama satırı | Adresi kopyala (`ftp://ip/`) |
| 3389 | Uzak Masaüstü | RDP | — | `mstsc /v:ip` |
| 445 | Dosya paylaşımı | SMB | — | Gezgin'de `\\ip` |
| 5432 | PostgreSQL | Veritabanı | — | Adresi kopyala (`ip:5432`) |
| 3306 | MySQL | Veritabanı | — | Adresi kopyala (`ip:3306`) |
| 1433 | SQL Server | Veritabanı | — | Adresi kopyala (`ip:1433`) |
| 9100 | Yazıcı ham portu (JetDirect) | Yazıcı | — (hiçbir şey yazılmaz) | Tarayıcıda `http://ip/` |
| 631 | IPP | Yazıcı | `GET /` | Tarayıcıda `http://ip/` |
| 5900 | VNC | VNC | karşılama satırı (`RFB …`) | Adresi kopyala |
| 554 | RTSP | Kamera | — | Adresi kopyala (`rtsp://ip/`) |

"Adresi kopyala" eylemleri ileride aile uygulamalarına derin bağlantı olarak değiştirilebilir: tek yer `src/actions.js › DEEP_LINKS`.

## Özellikler

- **Kayıtlar**: ad, renk, aralık; klasörlerle kart düzeni; arama. Kayda tıklayınca aralık taranır (son taramanın üzerinden
  30 sn geçmişse), sonuçlar sağda listelenir.
- **Sonuç listesi**: IP, ad (ters DNS / mDNS), MAC, üretici, yanıt süresi, servis etiketleri; sütun başlığıyla sıralama,
  Tümü / Yeni / Kaybolan / Servisli filtreleri, arama. Önceki taramaya göre **yeni** ve **kaybolan** cihazlar vurgulanır
  (MAC varsa MAC, yoksa IP ile eşleştirilir). Çift tık / sağ tık: ayrıntılar (karşılama, başlık, Server, sertifika), kopyalama.
- **Dışa aktarım**: CSV (UTF-8 BOM, Excel uyumlu) ve JSON.
- **Ayarlar**: Genel (dil, tema, Windows ile başlat, tepsi) · Hesap (senkron, çıkış) · Tarama (portları kapatma, eşzamanlılık ≤ 64,
  zaman aşımı ≤ 1 sn) · Hakkında (sürüm, güncelleme denetimi, lisanslar).
- İlk açılışta ve tarama ekranında kalıcı uyarı: **"Yalnız sahibi olduğunuz ya da yetkili olduğunuz ağları tarayın."**

## Kısayollar

| Kısayol | İşlev |
| --- | --- |
| `Ctrl+N` | Yeni kayıt |
| `Ctrl+F` | Arama kutusuna git |
| `F5` | Seçili kaydı tara |
| `Esc` | Taramayı durdur / aramayı temizle / pencereyi kapat |
| `F2` | Seçili kaydı düzenle |
| `Del` | Seçili kaydı sil |
| `Ctrl+E` | Sonuçları CSV olarak dışa aktar |
| `Backspace` | Üst klasöre çık |
| Çift tık (satır) | Cihaz ayrıntıları |

## Sürüm geçmişi

| Sürüm | Tarih | Notlar |
| --- | --- | --- |
| 1.0.0 | 2026-10 | İlk sürüm: kayıtlar/klasörler, ping + ARP canlılık, sabit 15 portluk servis denemesi, karşılama/başlık/sertifika okuma, ters DNS + mDNS, OUI üretici, yeni/kaybolan vurgusu, CSV/JSON, 8 dil, tema, tepsi, Mastertool hesabı ve ortak oturum |

## Bilinen sınırlar (tasarım gereği)

Aşağıdakiler bilinçli olarak **yoktur** ve kod tabanına girmez; IP Tools yalnız keşif ve envanter aracıdır:

- Zafiyet denemesi, parola/anahtar deneme, kimlik bilgisi kullanımı
- SNMP, SMB, NetBIOS, UPnP vb. protokol sorgulama (özel protokol paketi gönderilmez)
- SYN / yarı açık taraması, ham soket, geniş ya da özelleştirilebilir port taraması (liste sabit, yalnız daraltılabilir)
- İnternet (genel) adreslerinin taranması; IPv6
- 64 üstü eşzamanlılık, 1 sn üstü zaman aşımı, 30 sn içinde tekrar tarama, /16'dan geniş aralık

Diğer sınırlar:

- Ping'i ve ARP'ı engelleyen cihazlar (sıkı güvenlik duvarı) bulunamaz; bu cihazlar için port denemesi yapılmaz.
- Ad çözümleme yerel DNS/mDNS'e bağlıdır; ad yoksa "(ad çözülemedi)" gösterilir.
- MAC adresleri yalnız aynı yayın alanındaki (aynı alt ağ) cihazlar için ARP'tan alınabilir; yönlendirici arkasındakiler için MAC/üretici boş kalır.
- Rastgele ("özel") Wi-Fi MAC adresleri üreticiye eşlenemez.
- Tarama sonuçları yalnız yerelde tutulur; başka bilgisayara senkronlanmaz (yalnız kayıtlar ve ayarlar senkronlanır).
