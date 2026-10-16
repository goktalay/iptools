# IP Tools

Master Tool › Araçlar: yerel ağ keşfi ve envanteri. Kayıtlı IP aralıklarını tarar; bulunan cihazların adını, MAC adresini,
üreticisini, yanıt süresini ve açık servislerini listeler; servis etiketine tıklayınca ilgili uygulamayı açar.
Yalnız keşif yapar: sabit ve kısa port listesi, yalnız özel/yerel adresler, zafiyet/parola denemesi yok (bkz. `docs/site-teknik.md`).

- Tanıtım: https://mastertool.download/araclar/ip-tools · uygulama kodu `ip`
- Mastertool ortak iskeleti: 8 dil, Gece/Gündüz/Sistem teması, Ayarlar (Genel · Hesap · Tarama · Hakkında), tepsi, ortak oturum (SSO)

## Geliştirme

```
npm install
npm start          # Electron ile çalıştır
npm test           # aralık/özel-adres, OUI, karşılama/başlık ayrıştırma, etiket eylemleri, hız sınırı, SSO, i18n, ana süreç
npm run icon       # build/icon.svg → icon.png, icon.ico
npm run oui        # IEEE OUI listesini güncelle → src/data/oui.tsv.gz
npm run screenshots  # docs/screenshots/ (tr) ve docs/screenshots/en/ + manifest.json (sahte veriyle, gerçek ağ yok)
npm run dist       # Windows kurulum + portable (dist/)
```

Testler ve ekran görüntüleri gerçek ağa dokunmaz: tarayıcı sahte `exec/net/tls/dns/dgram` ile çalışır, adresler belgeleme
aralığından ya da örnek özel adreslerdir.

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| `src/main.js` | Ana süreç: depo, pencereler, tepsi, tarama yönetimi, IPC |
| `src/scanner.js` | Ping + ARP, TCP bağlantı denemesi ve izin verilen en küçük okuma, ters DNS + mDNS, karşılaştırma, CSV |
| `src/ports.js` | Sabit port listesi (yalnız kapatılabilir) |
| `src/ranges.js` | Aralık ayrıştırma ve özel-adres denetimi (RFC 1918 + 169.254/16, en çok /16) |
| `src/actions.js` | Etiket tıklama eylemleri; `DEEP_LINKS` aile uygulamalarına derin bağlantı için tek yer |
| `src/oui.js` + `src/data/oui.tsv.gz` | MAC → üretici (IEEE MA-L) |
| `src/account.js` | Mastertool hesabı, uçtan uca şifreli senkron (`/api/ip`, `ipt-enc-v1`) |
| `src/sso.js` | Cihazda ortak oturum (goktalay/mastertool ile birebir) |
| `src/i18n.js` | 8 dil |
| `src/renderer/` | Giriş ve ana pencere |
| `build/installer.nsh` | `Program Files\Mastertool\IP Tools` kurulumu (goktalay/sshmasters ile birebir) |

## Yayın

`v1.2.3` etiketi gönderilince GitHub Actions Windows exe'lerini derler, Release'e ekler ve mastertool.download'a yükler
(`IPTOOLS_RELEASE_KEY` secret'ı; `scripts/upload-iptools.sh`). Sürüm yayını yalnız açık onayla yapılır.
