# cloud/ — bulut yazıya dökme yolu (taslak, yayında değil)

Karar belgesi: [`docs/adr/ADR-039-cloud-transcript-route.md`](../docs/adr/ADR-039-cloud-transcript-route.md).
Bu klasör kendi başınadır: kendi `package.json`'ı vardır, web uygulamasının bağımlılıklarına ve
CI'daki `npm audit --omit=dev` kapısına dokunmaz; CI'a eklenmedi.

| Klasör | Ne |
|---|---|
| `harness/` | Sağlayıcı ölçüm düzeneği (Node, bağımlılıksız). Kurucu "başla" deyince sağlayıcıyı kendi gerçekçi kümemizde ölçer; puanlama ADR-036'nın ölçüleriyle aynıdır. |
| `worker/` | Cloudflare Worker vekili: anahtarı tutar, sesi akıtır, tavanı ve davet kodlarını uygular. Kurulum: [`worker/README.md`](worker/README.md). |
| `.env.example` | Anahtar dosyasının örneği. Gerçek dosya `cloud/.env` — git'e girmez (`.gitignore`: `.env*`). |

## Ölçüm düzeneği

```bash
# Kuru çalıştırma (varsayılan): ağ yok, anahtar okunmaz. Hangi dosyalar, ne kadar ses, tahmini bedel.
node cloud/harness/run.mjs
node cloud/harness/run.mjs smoke-fleurs-en long-conversation

# Gerçek koşu — YALNIZCA kurucunun açık onayıyla. Ses yüklenir, kredi harcanır.
node cloud/harness/run.mjs --i-have-founder-approval --region=eu smoke-fleurs-en
```

- Gerçek koşu üç şeyi birlikte ister: `--i-have-founder-approval`, açık dosya/kimlik listesi,
  `--region=eu|us`. Biri eksikse hiçbir istek gitmez.
- Anahtar `cloud/.env` içindeki `ASSEMBLYAI_API_KEY=...` satırından, yalnız gerçek koşuda okunur;
  hiçbir çıktıya yazılmaz (hata metinleri ve rapor süzülür).
- **Yalnız ses yüklenir:** ffmpeg görüntüyü, altyazı ve veri izlerini, üst veriyi (konum, cihaz adı)
  atar; mono 16 kHz, Opus 24 kbit/s (`--codec=flac` kayıpsız karşılaştırma içindir).
- `--max-usd` (varsayılan **0,50**): tahmin tavanı aşıyorsa yüklemeden önce durur.
- `web/tests/media/real/` altındaki her dosya kurucunun özel videosudur: `--allow-private`
  olmadan reddedilir, açılmaz bile.
- Her kayıt iş bitince sağlayıcıda silinir (yüklenen ses dosyasıyla birlikte); rapor bunu yazar.
- Rapor: `cloud/harness/results/<zaman>/report.md` ve `report.json` (git'e girmez).
- Ölçüm kümesi: `harness/manifest.json` (hangi durum, hangi dosya, hangisi eksik).

Çıkış kodları: 0 tamam · 1 bir dosya başarısız / silinemedi · 2 kullanım hatası · 3 tavan aşıldı · 4 özel dosya reddedildi.

## Sınamalar

```bash
cd cloud
npm ci
npm run test:harness   # node:test, 32 sınama — yerel sahte sağlayıcı (127.0.0.1)
npm run test:worker    # vitest + workerd, 22 sınama — sahte sağlayıcı, ağ yok
npm run typecheck
```

Fiyatlar `harness/lib/pricing.mjs` içinde sabittir (kaynak ve okunma tarihiyle); sağlayıcı fiyat
değiştirirse orası ve `worker/wrangler.jsonc` → `PRICE_USD_PER_HOUR` birlikte güncellenir.
