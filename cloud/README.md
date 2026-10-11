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

### Tam ölçüm kümesi (11 Ekim 2026) — kurucunun tek komutu

Küme hazır: 12 dosya, **115 dk 43 sn** ses, yüklenecek ses ≈ **20,8 MB** (Opus 24 kbit/s),
tahmini bedel **0,4439 $** (0,23 $/saat; tavan 0,50 $). Kuru çalıştırma 11 Ekim'de yapıldı; gerçek
koşu yapılmadı. PowerShell, `E:\capcut_better` içinden, tek satır:

```powershell
node cloud/harness/run.mjs --i-have-founder-approval --region=eu --max-usd=0.50 smoke-fleurs-en long-conversation meeting-overlap-4 far-field speech-under-music music-next-to-speech accent-call turkish-read-01 turkish-music-03 turkish-media-speech japanese-read two-speaker-overlap
```

Önce bakmak için aynı satır `--i-have-founder-approval` olmadan (kuru çalıştırma: ağ yok, anahtar okunmaz).

Krediyi korumak için **kırpılmış küme** (81 dk 07 sn, ≈ 14,6 MB, tahmini **0,3113 $**): ikinci
çağrı (`accent-call`) ve aynı toplantının uzak mikrofonu (`far-field`) çıkar, her durum yine en az bir kez ölçülür:

```powershell
node cloud/harness/run.mjs --i-have-founder-approval --region=eu --max-usd=0.50 smoke-fleurs-en long-conversation meeting-overlap-4 speech-under-music music-next-to-speech turkish-read-01 turkish-music-03 turkish-media-speech japanese-read two-speaker-overlap
```

| Kimlik | Dil | Kaynak (lisans) | Süre | Referans | Beklenen konuşmacı |
|---|---|---|---|---|---|
| `smoke-fleurs-en` | en | FLEURS en_us (CC BY 4.0), depoda | 0:10 | var | 1 |
| `long-conversation` | en | Earnings-22 çağrı 4474229 (CC BY-SA 4.0) | 51:23 | var (kelime zamanı yok) | 4 (referanstaki konuşmacı kimlikleri) |
| `meeting-overlap-4` | en | AMI IS1009a, kulaklık karışımı (CC BY 4.0) | 13:59 | var + kelime zamanları | 4 |
| `far-field` | en | AMI IS1009a, tek uzak masa mikrofonu (CC BY 4.0) | 13:59 | var + kelime zamanları | 4 |
| `speech-under-music` | en | AMI TS3003a 11:00–16:00 + müzik (CC BY 4.0 / CC BY 3.0) | 5:00 | var + kelime zamanları | 3 (o aralıkta sözü olanlar; biri yalnız 19 kelime) |
| `music-next-to-speech` | en | LibriSpeech okuyucu 5105 + Commons müzik/ses (CC BY 4.0, CC BY 3.0, CC0) | 1:39 | var + kelime zamanları + 6 boşluk | 1 |
| `accent-call` | en | Earnings-22 çağrı 4481221 (CC BY-SA 4.0) | 20:37 | var (kelime zamanı yok) | 6 (referanstaki konuşmacı kimlikleri) |
| `turkish-read-01` | tr | FLEURS tr_tr (CC BY 4.0) | 0:10 | var | 1 |
| `turkish-music-03` | tr | FLEURS tr_tr + sentetik müzik, SNR 5 dB | 0:10 | var | 1 |
| `turkish-media-speech` | tr | MediaSpeech Türkçe, OpenSLR SLR108 (CC BY 4.0): 20 haber/söyleşi parçası | 5:03 | var (elle yazılmış) | bilinmiyor |
| `japanese-read` | ja | FLEURS ja_jp (CC BY 4.0): 10 okunmuş cümle | 1:57 | var → **CER** | bilinmiyor (2–10 ses) |
| `two-speaker-overlap` | en | LibriSpeech okuyucu 1089 + 121, burada üst üste bindirildi (CC BY 4.0) | 1:37 | var + kelime zamanları + kim söyledi | 2 |
| `turkish-conversation` | tr | **eksik**: açık, girişsiz, güvenilir referanslı kaynak bulunamadı | — | — | — |
| `japanese-conversation` | ja | **eksik**: aynı neden | — | — | — |

Her girdinin tam adresi, bayt sayısı, sha256'sı, cümle/dosya kimlikleri ve indirme tarihi
`harness/manifest.json` → `source` alanındadır (süreler ffprobe ile ölçüldü).

**Kümeyi yeniden kurmak** (ses dosyaları git'e girmez; toplam indirme ≈ 1,34 GB, diskte ≈ 2,3 GB; giriş/hesap yok).
Windows'ta **PowerShell'den** çalıştırın — betikler `tar` çağırır, Git Bash'in `tar`'ı `E:\` yolunu açamaz.
Wikimedia art arda indirmede 429 verebilir; betik kaldığı yerden sürer, bir dakika sonra yeniden çalıştırın.

```powershell
node web/spike/asr/prepare-speech.mjs                           # FLEURS tr/en (42 MB)
node web/spike/asr/prepare-english.mjs                          # LibriSpeech test-clean 347 MB + hizalamalar 623 MB + FLEURS 48 MB + müzik
node web/scripts/transcript/prepare-realistic.mjs --set=val     # AMI, Earnings-22, sesler (≈ 160 MB)
node cloud/harness/prepare-extra.mjs                            # FLEURS ja (16 MB), MediaSpeech TR (ilk 80 MB), iki konuşmacı
```

**Normalleştirilmiş İngilizce WER** için puanlama ortamı (ADR-036'daki ile aynı; yoksa rapor "not computed" yazar, tahmin etmez):

```powershell
cd web/spike/asr; python -m venv .venv; .venv\Scripts\pip install whisper-normalizer==0.1.15; cd ..\..\..
```

**Puanlamayı okurken:**

- **Japonca kelime hatasıyla ölçülmez** (kelimeler arasında boşluk yok): rapor **CER** (karakter hata oranı)
  yazar. İki taraf da NFKC'den geçer (tam/yarım genişlik aynı sayılır), noktalama ve boşluk atılır. Kanji
  rakam ↔ rakam (七十 / 70) ve kana ↔ kanji yazım farkları **hata sayılır** (Japonca metin normalleştirici
  yok): CER'i üst sınır olarak okuyun.
- **Türkçe:** büyük/küçük harf Türkçe kuralıyla (İ→i, I→ı) çevrilir, kelime içi kesme işareti iki tarafta da
  korunur. Yalnız "katı" ölçü vardır: sayının rakamla yazılması ("19" ↔ "ondokuz"), düşen kesme işareti
  ("Ayasofya'yı" ↔ "ayasofyayı") ve şapkalı harf ("hâlâ" ↔ "hala") hata sayılır. `turkish-media-speech`
  referansı küçük harf, noktalamasız ve sayılar yazıyla olduğundan oradaki WER üst sınırdır.
- **`two-speaker-overlap`** sentetiktir (iki okunmuş ses üst üste; 264 kelimenin 95'i örtüşmede). Örtüşme
  içinde referans sırası "başlangıç zamanına göre"dir; iki sesi art arda yazan sağlayıcı sıra hatası alır.
  Burada temiz ölçü konuşmacı sayısıdır (2). Gerçek örtüşme için `meeting-overlap-4`.
- **Referansı olmayan dosya** (kurucunun kendi videoları, komut satırından verilen yol) için hata oranı
  yazılmaz; raporda "no reference — listening check only" görünür. Kuru çalıştırma her dosya için
  `ref=yes` / `ref=yes (CER)` / `ref=NO` yazar.
- Konuşmacı sayısı yalnız veri kümesinin kendisi söylediğinde doldurulur; Earnings-22'de birkaç kelimelik
  kimlikler (operatör) sağlayıcıda birleşebilir — tam eşleşme beklemeyin, kaba akıl kontrolüdür.

Çıkış kodları: 0 tamam · 1 bir dosya başarısız / silinemedi · 2 kullanım hatası · 3 tavan aşıldı · 4 özel dosya reddedildi.

## Sınamalar

```bash
cd cloud
npm ci
npm run test:harness   # node:test, 39 sınama — yerel sahte sağlayıcı (127.0.0.1)
npm run test:fake      # node:test, 23 sınama — yerel sahte Worker; 18'i gerçek Worker'la ORTAK sözleşme (contract/cases.mjs)
npm run test:worker    # vitest + workerd, 43 sınama (25 + aynı 18 sözleşme) — sahte sağlayıcı, ağ yok
npm run typecheck
```

Fiyatlar `harness/lib/pricing.mjs` içinde sabittir (kaynak ve okunma tarihiyle); sağlayıcı fiyat
değiştirirse orası ve `worker/wrangler.jsonc` → `PRICE_USD_PER_HOUR` birlikte güncellenir.
