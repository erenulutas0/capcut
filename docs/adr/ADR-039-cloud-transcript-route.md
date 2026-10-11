# ADR-039 — Bulut yazıya dökme yolu (isteğe bağlı, davetli): yalnız ses çıkar, anahtar bir Worker'da durur

> Tarih: 10 Ekim 2026 · Durum: **ÖNERİ / TASLAK** — hiçbir şey yayında değil, politika değişmedi
> · 11 Ekim 2026: ilk gerçek ölçüm (ek) · 11 Ekim 2026: **istemci yapıldı, KAPALI doğar** (ek, "İstemci yapıldı");
> Worker yayınlanmadı, durum kurucu yayınlayana kadar taslak kalır
> İlgili: [ADR-036](ADR-036-on-device-transcript.md) (cihaz üstü yazıya dökme ve "Hâlâ zayıf olan"),
> `docs/spikes/2026-10-03-asr-on-device-english.md`, `video-editor-blueprint/docs/15_PRICING_FREE_PRO.md`,
> `docs/privacy/DATA_INVENTORY.md`, `docs/security/2026-09-30-static-site-hardening.md`.
> Kod: `cloud/` (ölçüm düzeneği + Worker; kurulum `cloud/worker/README.md`).
>
> **Bu çalışmada sağlayıcıya (AssemblyAI) ya da başka bir ücretli/dış hizmete tek bir istek
> gitmedi; hiçbir ses ya da medya bu makineden çıkmadı; hiçbir API anahtarı okunmadı;
> Cloudflare'e hiçbir şey yüklenmedi.** Her şey yerel bir sahte sağlayıcıya karşı sınandı.
> Aşağıdaki fiyat ve sınırlar sağlayıcıların herkese açık belgelerinden, **10 Ekim 2026**'da
> okundu; her birinin yanında adresi var. Belgelerden doğrulanamayan her şey
> "Doğrulanmayanlar" başlığında tek tek yazılıdır; hiçbir tahmin ölçüm ya da belge diye sunulmadı.

## Neden

Cihaz üstü yol (Whisper `base` / `large-v3-turbo`, ADR-036) ücretsiz ve gizli, ama ölçtüğümüz
yerlerde yetmiyor: çok kişili ve üst üste konuşmada en iyi durumda bile normalize WER %21–22;
müzik altındaki konuşmada küçük modelle %54,8; uzak mikrofonda %34–47; 51 dakikalık çağrıda
`turbo` bile %11; konuşmacı ayrımı ve çeviri hiç yok; Türkçe ve Japonca açık değil; WebGPU'suz
cihazlar (telefonlar) en zayıf modelde kalıyor. Kurucu kararı: buna **isteğe bağlı bir bulut
yolu** eklenecek — ama önce ölçülecek, arayüzden önce maketler görülecek, ve deneme dönemi
**yalnızca sağlayıcının ücretsiz kredisiyle, kart tanımlamadan** yürüyecek.

## Öneri (karar değil)

1. **Sağlayıcı adayı: AssemblyAI**, önceden kaydedilmiş ses (async) API'si. Seçim ölçümden sonra
   kesinleşir (aşağıda "Ölçüm planı").
2. **Cihazdan yalnızca ses çıkar.** Tarayıcı videonun sesini kendisi ayırır (mono, 16 kHz, Opus
   ~24 kbit/s) ve yalnız onu yollar. Görüntü, dosya adı, konum ve cihaz bilgisi yollanmaz.
3. **Tarayıcı sağlayıcıyla doğrudan konuşmaz.** Durağan sitede sır saklanamaz; araya kendi
   Cloudflare Worker'ımız girer (`cloud/worker/`). Anahtar yalnız orada durur (`wrangler secret`).
4. **Davetli ve tavanlı.** Davet kodu olmadan çalışmaz; davet başına dakika hakkı ve aylık kesin
   USD tavanı vardır; tavan **0 (kapalı)** olarak doğar.
5. **Sağlayıcıda iz bırakmamak hedeflenir:** sonuç tarayıcıya geçince kayıt (ve yüklenen ses)
   sağlayıcıda silinir; tarayıcı dönmezse Worker'ın temizlik alarmı siler.
6. **Cihaz üstü yol varsayılan ve yedek olarak kalır.** Bulut yolu kapalıyken, kotası bitince,
   tavan dolunca, Worker ya da sağlayıcı yanıt vermeyince kullanıcı cihaz üstü yolla devam eder;
   hiçbir mevcut özellik buluta bağlanmaz.

## Mimari ve veri akışı

```
 KULLANICININ CİHAZI (tarayıcı)                     BİZİM WORKER'IMIZ                 SAĞLAYICI (AssemblyAI)
 ─────────────────────────────                     (Cloudflare, Free plan)           (AB ya da ABD bölgesi)
 video dosyası  ── cihazda kalır ──┐
                                   │ sesi ayır, mono 16 kHz Opus
 [rıza ekranı: kullanıcı onaylar]  ▼
 ses dosyası (≈ 0,18 MB/dk) ─────── POST /v1/jobs ──▶ davet? köken? tür? süre? hız sınırı?
   + davet kodu, süre, dil                           tavan + dakika hakkı AYIR (defter)
                                                     gövdeyi belleğe almadan akıt ───▶ POST /v2/upload      → upload_url
                                                     anahtarı Worker ekler ──────────▶ POST /v2/transcript  → kayıt kimliği
                                    ◀── 202 { jobId } (kendi rastgele kimliğimiz)
 GET /v1/jobs/:id  (birkaç sn'de bir) ─────────────▶ ─────────────────────────────▶ GET /v2/transcript/:id
                                    ◀── { status }   bitince: GERÇEK süreyi deftere yaz
 GET /v1/jobs/:id/result ──────────────────────────▶ ─────────────────────────────▶ GET /v2/transcript/:id
                                    ◀── yazı + kelime zamanları + konuşmacılar (olduğu gibi geçer, Worker okumaz)
                                                     tarayıcı hepsini alınca ────────▶ DELETE /v2/transcript/:id
                                                                                       (kayıt + yüklenen ses silinir)
 yazı tarayıcıda, projede saklanır
 (IndexedDB, bugünkü gibi)                           defterde kalan: aşağıdaki tablo
```

Uç şekilleri ve alan adları (belgelerden): `POST /v2/upload` ham bayt, `Content-Type:
application/octet-stream`, yanıt `{ upload_url }`, en çok 2,2 GB; `POST /v2/transcript` JSON
(`audio_url`, `speech_models`, `language_code` **ya da** `language_detection`, `speaker_labels`,
`audio_end_at` …), yanıt `{ id, status }`; durumlar `queued | processing | completed | error`;
`words[].start/end` milisaniye, `audio_duration` saniye; kimlik `authorization: <anahtar>`
başlığı; bölgeler `api.assemblyai.com` (ABD) ve `api.eu.assemblyai.com` (AB).
Kaynak: <https://www.assemblyai.com/docs/api-reference/files/upload>,
<https://www.assemblyai.com/docs/api-reference/transcripts/submit>,
<https://www.assemblyai.com/docs/api-reference/transcripts/delete>.

### Worker: tasarım seçimleri

- **Depolama: tek bir SQLite destekli Durable Object ("defter").** KV değil: KV sonunda tutarlıdır
  ve "oku-karşılaştır-yaz" yoktur; aynı anda gelen iki başlatma ikisi de "tavanın altındayım"
  okuyabilir, aşım eşzamanlı istek sayısıyla büyür. Durable Object istekleri sırayla işler;
  "tavanı denetle + ayır" tek atomik adımdır. Free planda Durable Object **vardır**, yalnızca
  SQLite destekli türü ("Workers Free plan can only create and access SQLite-backed Durable
  Objects"); ücretli plan gerekmez. D1 de olurdu ama aynı atomikliği tek istekte vermez ve ek bir
  kaynak kurdurur.
- **Yükleme akıtılır.** Worker ilk parçaya bakar (dosya gerçekten ses mi), sonra gövdeyi
  `FixedLengthStream` ile sağlayıcıya geçirir; dosya Worker belleğinde toplanmaz. Sonuç da
  ayrıştırılmadan geçirilir (Free planın istek başına 10 ms işlemci süresi yüzünden: iki saatlik
  bir kaydın sonucu megabaytlarca JSON'dur).
- **Boyut ve süre sınırları.** Cloudflare Free/Pro hesapta istek gövdesi en çok **100 MB**.
  120 dakikalık ses 24 kbit/s Opus ile ≈ **21,6 MB**; Worker'ın kabul ettiği en yüksek hızda
  (64 kbit/s) ≈ 57,6 MB. İş başına en çok 120 dakika (web girdi sınırıyla aynı).
  Kayıpsız FLAC (≈ 100–140 MB / 120 dk) Free planda **sığmaz**; ürün Opus yollamalıdır.
- **Kötüye kullanım ve para denetimi:** kökene kilitli CORS, davet kodu (yalnız özeti saklanır),
  davet başına dakika, davet başına aynı anda tek iş, aylık kesin USD tavanı (0 = kapalı), IP
  başına saatlik deneme sınırı, iş başına süre sınırı, ses olmayan içeriğin reddi (tür + ilk
  baytlar), `ENABLED` değişkeni ve yeniden yayın gerektirmeyen acil kapatma düğmesi.
  Ayrıntı ve işletme: `cloud/worker/README.md`.
- **Tavanın en kötü durumu.** Yarıştan doğan aşım **0** (sınandı: aynı anda beş başlatmadan ikisi
  kabul, ayrılan 0,92 $ ≤ 1 $). Kalan risk süreyi yanlış beyan eden davetlidir: sağlayıcı
  `audio_end_at`'e göre faturalıyorsa aşım ≈ 1 sn; tüm dosyaya göre faturalıyorsa (doğrulanmadı)
  bir iş en çok 10 saat × 0,23 $ = **2,30 $** yakar, sonra o davet askıya alınır ve tavan
  devreye girer. En kötü durum: (aynı anda hile yapan davet sayısı) × 2,30 $. Deneme döneminde
  mutlak sınır kalan ücretsiz kredidir (kart yok → kredi bitince API durur).

### Worker ne saklar

Ses yok, yazı yok, günlük yok. Durable Object'te: davet kodunun özeti + kurucunun verdiği etiket +
dakika; iş başına rastgele kimlik, davet özeti, sağlayıcının kayıt kimliği (sağlayıcıda silinince
boşaltılır), beyan/ayrılan/gerçek saniye, bayt sayısı, durum, zaman damgaları (90 gün); ay başına
toplam; hız sınırı için IP'nin tuzlanmış özeti ve o saatin sayacı (saat dolunca silinir, en çok
~70 dk). Ham IP, dosya adı, dil, davet kodunun kendisi saklanmaz.

## Cihazdan ne çıkar, kime gider, orada ne kadar kalır

| Ne | Kime | Ne kadar |
|---|---|---|
| Videonun **sesi** (konuşmalar, arka plan sesi, müzik) | Worker üzerinden AssemblyAI'ye (akar, Worker'da durmaz) | Biz silene kadar; silme çağrısı kaydı ve yüklenen sesi "hemen" siler. Silmezsek: yüklenen ses için silme 24 saatte başlar, en çok 48 saat; yazı 30 gün sonra kendiliğinden silinir. |
| Yazı (sağlayıcının ürettiği) | AssemblyAI'de oluşur, Worker'dan geçer, tarayıcıda kalır | yukarıdaki gibi |
| Süre, bayt sayısı, davet özeti | Worker'ın defteri (Cloudflare) | 90 gün |
| IP adresi | Cloudflare ağı görür; biz yalnız tuzlanmış özetini bir saat tutarız | ≤ ~70 dk |
| **Görüntü, dosya adı, konum, cihaz bilgisi** | **hiç kimseye** | — |

Sağlayıcı belgelerinden (10 Ekim 2026):

- Silme: "Files uploaded via the /upload endpoint are immediately deleted alongside the
  transcript"; silinen kayıtta "certain metadata" (kayıt kimliği, süre) faturalama için kalır.
  <https://www.assemblyai.com/docs/api-reference/transcripts/delete>
- Saklama tablosu (async, TTL/BAA yokken): yüklenen ses "Deletion process begins at 24 hours and
  is at most 48 hours"; yazı "Deletion process begins at 30 days and is automatic thereafter".
  <https://www.assemblyai.com/docs/data-retention-and-model-training>,
  <https://www.assemblyai.com/docs/faq/how-long-are-outputs-retained>
- **Model eğitimi:** "Only certain files submitted to the API, as permitted by the applicable
  contract, are used for model training." Kullanılmayanlar: BAA'lı müşteriler, **Avrupa
  sunucularını kullananlar**, eğitimden çıkanlar. Eğitimden çıkma ve TTL ayarı (Data Controls)
  **ücretli plan ister**: "You must be on a paid plan to access Data Controls."
  <https://www.assemblyai.com/docs/data-controls>
  → Ücretsiz krediyle ve kartsız çalışırken eğitimden çıkmanın belgelenmiş tek yolu **AB
  uç noktasını** kullanmaktır. Ücretsiz hesabın AB uç noktasını kullanabildiği belgede açıkça
  yazmıyor (kısıt da yazmıyor) — ilk gerçek çağrıda görülecek.
- AB bölgesi: "guarantees your data never leaves the European Union".
  <https://www.assemblyai.com/docs/pre-recorded-audio/select-the-region>
- DPA: Hizmet Şartları'nın eki; müşteri veri sorumlusu, AssemblyAI işleyen; alt işleyen listesi
  <https://www.assemblyai.com/trust>; aktarım dayanağı EU-U.S. Data Privacy Framework, yoksa SCC;
  "primary processing operations take place in the United States"; son değişiklik 22 Ocak 2026.
  <https://www.assemblyai.com/legal/data-processing-addendum>

## Rıza ekranı — ne söylenmeli (metin önerisi; arayüz yapılmadı)

> **11 Ekim 2026:** aşağıdaki metin önerisinin yerini kurucunun seçtiği **B, "İki yol yan yana"**
> ekranı aldı (bkz. "Ek, 11 Ekim 2026 — istemci yapıldı"). Kurallar aynen bağlayıcıdır ve sınanır.

Kurallar: bulut yolu **her seferinde** kullanıcının açık eylemiyle başlar; ön seçili değildir;
rıza ekranı geçilmeden tek bayt yollanmaz; "Hayır, cihazımda yaz" aynı büyüklükte bir düğmedir;
metin çocuğun anlayacağı sadeliktedir; "güvenli", "şifreli", "anonim" gibi kanıtlayamayacağımız
sözcükler kullanılmaz.

Önerilen metin:

> **Daha iyi yazı için sesi internete gönderelim mi?**
>
> - Videonun **yalnızca sesi** gider. **Görüntü gitmez**, cihazında kalır.
> - Ses, **AssemblyAI** adlı bir şirketin bilgisayarlarına gider. Yazıyı onlar çıkarır.
> - Yazı gelince oradaki sesi ve yazıyı **sileriz**. (Bir aksilik olursa en geç 1 gün içinde.)
> - Bu videonun sesi **[23] dakika**. Hakkından **[23] dakika** düşer; **[37] dakikan** kalır.
> - İstemezsen sorun değil: yazıyı cihazında da çıkarabiliriz. Biraz daha az doğru olur, hiçbir şey gitmez.
>
> [ Sesi gönder ]  [ Hayır, cihazımda yaz ]

Ekranda ayrıca (küçük ama okunur): sesin hangi bölgeye gittiği (AB / ABD — kurucu kararı);
"Sesinde başka insanlar da konuşuyorsa onların sesi de gider"; gizlilik sayfasına bağlantı.
Söylenmemesi gereken: "kimse dinlemez", "eğitimde kullanılmaz" (ABD bölgesinde ve ücretsiz planda
bunu sağlayamıyoruz — yukarıda).

## Maliyet modeli

Fiyatlar (<https://www.assemblyai.com/pricing>, 10 Ekim 2026; önceden kaydedilmiş ses, saat başına):

| Kalem | Fiyat |
|---|---|
| Universal-3.5 Pro (`universal-3-5-pro`) | 0,21 $/saat |
| Universal-2 (`universal-2`) | 0,15 $/saat |
| Konuşmacı ayrımı (async, standart) | +0,02 $/saat |
| Çeviri (yalnız önceden kaydedilmiş) | +0,06 $/saat |

Faturalama: "pro-rated to the exact second of audio processed"; hata veren istek ücretlendirilmez.
Önerilen bileşim (Universal-3.5 Pro + konuşmacı ayrımı) = **0,23 $/saat = 0,0038 $/dakika**.

| | Dakika karşılığı (0,23 $/saat) |
|---|---|
| 60 dakikalık bir davet | 0,23 $ |
| Aylık tavan 1 $ | ≈ 260 dakika (4,3 saat) |
| Aylık tavan 5 $ | ≈ 1 304 dakika (21,7 saat) |
| Aylık tavan 10 $ | ≈ 2 608 dakika (43,5 saat) |
| 50 $ ücretsiz kredinin tamamı | ≈ 217 saat |

Çeviriyle birlikte 0,29 $/saat. Cloudflare tarafı Free planda 0 $.

**Ücretsiz kredi nasıl çalışır** (10 Ekim 2026):
<https://www.assemblyai.com/pricing> — kayıtta **50 $ ücretsiz kredi, kredi kartı gerekmez**;
<https://www.assemblyai.com/docs/faq/what-happens-when-i-have-used-all-of-my-free-tier-credits> —
kredi önceden kaydedilmiş STT, gerçek zamanlı STT, Speech Understanding (çeviri dahil) ve
Guardrails'i kapsar; **LLM Gateway kapsamaz**; "Credits do not expire"; kredi bitince devam etmek
için kart eklemek gerekir ve otomatik ödeme yokken bakiye 0 $ olunca **"API access is paused
until you top up"** — yani kart tanımlı değilse sağlayıcı kendiliğinden para çekemez, API durur.
Ücretsiz hesapta aynı anda 5 async iş; fazlası sıraya girer
(<https://www.assemblyai.com/docs/faq/what-are-my-concurrency-limits>).
Kurucunun kendi hesabındaki bakiye panelden (Billing) doğrulanmalı; belgelerde ve blog
yazılarında farklı dönemlerden farklı ücretsiz kota anlatımları var (100 saat, 185 saat).

## Çeviri: sağlayıcı sunuyor mu?

Evet, iki yoldan; **hiçbiri bu çalışmada kurulmadı.**

1. **Aynı istekte:** `speech_understanding.request.translation` (`target_languages`, `formal`,
   `match_original_utterance` — bu sonuncusu konuşmacı ayrımı açıkken her söz için çeviri verir).
   86 dil; Türkçe `tr`, Japonca `ja`, İngilizce `en`. +0,06 $/saat; ücretsiz kredi kapsar.
   <https://www.assemblyai.com/docs/speech-understanding/translation>
2. **Sonradan, var olan kayıt üstünde:** `https://llm-gateway.assemblyai.com/v1/understanding`'e
   `transcript_id` ile. Bu uç LLM Gateway'dir; ücretsiz kredi **kapsamaz** ve kayıt sağlayıcıda
   durmalıdır (bizim "hemen sil" kuralımızla çelişir).
3. **Ayrı bir adım olarak, yalnız metinle:** yazı cihaza geldikten sonra metni başka bir çeviri /
   LLM hizmetine yollamak. Ses gitmez ama metin ikinci bir şirkete gider; ikinci bir anahtar,
   ikinci bir rıza cümlesi ve ikinci bir fiyat demektir. Fiyatı bu çalışmada araştırılmadı.

Öneri: çeviri istenirse 1. yol (tek istek, tek sağlayıcı, kredi kapsıyor). Çeviride altyazı
zamanlaması söz (utterance) düzeyindedir, kelime düzeyinde değil — satır bölme kuralımız
(ADR-036 §4) çeviride yeniden düşünülmelidir.

## Ölçüm planı (kurucu "başla" deyince)

Düzenek: `cloud/harness/` (kullanım `cloud/README.md`). Varsayılan kuru çalıştırmadır; gerçek
koşu `--i-have-founder-approval` + açık liste + `--region` ister. Yalnız ses yüklenir; her kayıt
sonunda sağlayıcıda silinir; rapor dosya başına WER (normalize ve katı), silinen kelime payı,
"konuşma süresinin yazılan payı", kelime zamanı hatası (ortanca, p95, ±250 ms içindekilerin
payı), konuşmacı sayısı (bulunan / beklenen), toplam süre, gerçek zaman katsayısı, yüklenen bayt
ve bedeli yazar. Puanlama ADR-036'nın normalleştiricisini (`web/spike/asr/metrics.mjs`,
`normalize_en.py`) kullanır; sayılar cihaz üstü tablolarla yan yana konabilir. **Bir fark:**
cihazda "yazıldı" bir aralığın (span) içinde olmaktır; sağlayıcı aralık değil kelime döndürür,
burada aralık "en çok 1,0 sn boşluklu kelime dizisi ± 0,25 sn" olarak kurulur — rapor bunu söyler.

| Durum | Dosya (`cloud/harness/manifest.json`) | Süre | Cihazda (ADR-036, `base` / `turbo` WER n.) |
|---|---|---|---|
| İlk deneme çağrısı | `smoke-fleurs-en` (depoda) | 9,6 sn | — |
| Uzun sohbet | `long-conversation` — Earnings-22 çağrı 4474229 | 51 dk | %14,7 / %11,1 |
| Üst üste konuşma, 4 kişi | `meeting-overlap-4` — AMI IS1009a, yaka mikrofonları | 14 dk | %25,5 / %21,9 |
| Uzak mikrofon | `far-field` — aynı toplantı, tek masa mikrofonu | 14 dk | %34,2 / %25,8 |
| Müzik altında konuşma | `speech-under-music` — AMI TS3003a + müzik, SNR 10 dB | 5 dk | %54,8 / %22,4 |
| Uydurma metin | `music-next-to-speech` — konuşmaya bitişik müzik | ~2 dk | boşluğa 0 kelime |
| Aksanlı çağrı (isteğe bağlı) | `accent-call` — Earnings-22 4481221 | 21 dk | %15,7 / %10,9 |
| Türkçe (okunmuş) | `turkish-read-01`, `turkish-music-03` — FLEURS | ~12 sn × 2 | ölçülmedi |
| **Türkçe sohbet** | **eksik — dosya gerekiyor** | | |
| **Japonca (okunmuş / sohbet)** | **eksik — dosya gerekiyor** (FLEURS `ja_jp` üretilebilir; sohbet için kaynak yok) | | |
| **İki kişi, üst üste** | **eksik — dosya gerekiyor** (iki LibriSpeech okuyucusundan haklar temiz üretilebilir) | | |
| Kurucunun kendi videoları | `founder-real-*` — `private: true`, `--allow-private` olmadan reddedilir | | |

Üretilmiş kümeler git'te değildir ve bugün bu makinede yoktur
(`web/tests/media/speech/` yok); ölçümden önce `prepare-english.mjs`, `prepare-realistic.mjs
--set=val` ve `prepare-speech.mjs` ile yeniden üretilir (açık lisanslı kaynakları indirir; hiçbir
şey yüklemez).

**Tahmini bedel** (kuru çalıştırmanın çıktısı, süreler ADR-036'nın yuvarlak süreleri): var olan
ve üretilebilir sekiz kayıt + deneme çağrısı ≈ **107 dakika → ≈ 0,41 $** (0,23 $/saat); 50 $'lık
kredinin ≈ %0,8'i. Aksanlı çağrı çıkarılırsa ≈ 86 dk → ≈ 0,33 $. Varsayılan tavan `--max-usd
0,50`. Kayıpsız (FLAC) karşılaştırma koşusu aynı bedeli ikinci kez öder.

Ölçümde bakılacaklar: (a) yukarıdaki dört zayıf durumda cihaz üstü `turbo`'yu belirgin geçiyor
mu; (b) konuşmacı sayısı doğru mu; (c) müzikte uydurma metin yazıyor mu; (d) 51 dakikanın
dönüş süresi; (e) Opus 24 kbit/s doğruluğu düşürüyor mu (FLAC ile aynı dosya); (f) AB uç
noktası ücretsiz hesapla çalışıyor mu.

## Hata durumları

| Ne olur | Kullanıcı ne görür (öneri) | Para |
|---|---|---|
| Bulut kapalı / tavan doldu (`cloud_off`, `monthly_cap_reached`) | "Şu an internetten yazamıyoruz. Cihazında yazalım mı?" | 0 |
| Davet dakikası bitti (`invite_minutes_used_up`) | "Dakikan bitti. Cihazında yazabiliriz." | 0 |
| Dosya çok uzun / ses değil | Göndermeden önce cihazda yakalanmalı; Worker da reddeder | 0 |
| Yükleme yarıda kesildi (sekme kapandı, ağ gitti) | Ayrılan dakika 30 dk içinde geri verilir | 0 (yükleme ücretsiz; kayıt açılmadı) |
| Sağlayıcı hata verdi (yükleme / başlatma) | "Olmadı. Tekrar dene ya da cihazında yaz." Sağlayıcının metni kullanıcıya geçmez. | 0; ayrılan geri verilir |
| Kayıt sağlayıcıda `error` ile bitti | aynı | 0 ("If a request errors, you aren't charged for it") |
| Kullanıcı sonucu almadan sekmeyi kapattı | Yazı kaybolur; 60 dk içinde dönerse alabilir, sonra silinir | Ücret ödendi, dakika düştü |
| Sonuç indirilirken bağlantı koptu | Kayıt silinmez; yeniden istenebilir (60 dk) | — |
| Sağlayıcının kredisi bitti (kart yok) | Her iş `provider_error`; kullanıcı cihaz üstüne yönlendirilir | 0 |
| Cloudflare Free günlük sınırı doldu (100 000 istek) | Worker yanıt vermez; cihaz üstü yol çalışır | 0 |
| Silme çağrısı başarısız | Temizlik alarmı sonuç hazır olduktan 60 dk sonra (her durumda en geç 24 saatte) siler, başaramazsa 10 dakikada bir yeniden dener; `/admin/spend` "sağlayıcıda duran kayıt" sayısını gösterir | — |

## Cihazda kalan (yedek)

Bugünkü her şey: cihaz üstü yazıya dökme (`base` / `turbo`), altyazı düzenleme, yazıdan kesit,
dışa aktarma. Bulut yolunun sonucu aynı veri şekline (kaynak zamanlı altyazı izi, EDL v3+) çevrilir;
konuşmacı etiketleri için şema eklemesi gerekir (bu çalışmada tasarlanmadı).

## Yayın anında değişecekler (şimdi DEĞİŞMEDİ)

> **11 Ekim 2026:** tablonun ilk üç satırı **koşullu olarak** yapıldı — CSP, veri envanteri (§8) ve
> gizlilik sayfası artık derleme ayarına bakıyor; ayar boşken (bugün) hiçbiri değişmez. Politika
> (belge 15), veri sorumlusu, sağlayıcı sözleşmesi ve bağımlılık denetimi satırları **açık**. CI'ya
> iki şey eklendi: Pages derlemesi ve duman sınaması `vars.CLOUD_TRANSCRIPT_URL` değişkenini okur
> (tanımsız = kapalı), ve bulut istemcisi yerel sahte Worker'a karşı koşar (yayını durdurmaz).

| Nerede | Ne değişir |
|---|---|
| `web/scripts/lib/csp.mjs` (+ `web/tests/unit/csp.test.ts`, `docs/security/2026-09-30-static-site-hardening.md`) | `connect-src 'self'` → `'self' https://<worker-adresi>`. Tek bir kesin köken; joker yok. Sağlayıcının adresi **eklenmez** (tarayıcı ona hiç gitmez). Güvenlik belgesindeki "Uygulama dışarıya istek atmaz" satırı ve "origin dışı istek 0" e2e/duman denetimleri bulut yolu için ayrılmalı (rıza verilmeden origin dışı istek 0 kalmalı — bu sınanmalı). |
| `docs/privacy/DATA_INVENTORY.md` | §4.1 "origin dışında istek: yok" artık koşullu; yeni bölüm: bulut yolu — ne çıkar, kime, saklama, silme; Worker defterindeki alanlar; §6 "bu envanteri geçersiz kılacak değişiklikler" zaten bunu bekliyor. |
| Gizlilik sayfası (`web/src/app/gizlilik/`) | Sağlayıcının adı, bölge, neyin gittiği / gitmediği, silme, davet defteri, haklar ve iletişim (K02'ye bağlı). |
| `video-editor-blueprint/docs/15_PRICING_FREE_PRO.md` + `web/src/domain/policy.ts` (+ `web/tests/unit/policy.test.ts`) | "AI işlemleri (bulut / ücretli): Free'de yok" satırı bugün doğru ve **değişmedi**. Davetli deneme açılırsa yeni politika sürümü: kim, kaç dakika, tek iş süresi, "deneme — kalıcı hak değildir". Mevcut "Cloud hakları" tablosu video *render* içindir; yazıya dökme dakikası ayrı bir hak olarak yazılmalı. |
| Veri sorumlusu (belge 30 **K02**, kararsız) | Bulut yolu kişisel veriyi (ses) üçüncü tarafa aktaran ilk özelliktir. Veri sorumlusu, iletişim adresi ve hukuki dayanak belirlenmeden **davetli deneme dışına açılamaz**. AssemblyAI'nin DPA'sı müşteriyi "Controller" sayar — o müşteri kim? |
| Sağlayıcı sözleşmesi / bölge | DPA Hizmet Şartları'nın ekidir; ayrıca imza gerekip gerekmediği ve ücretsiz hesabı kapsayıp kapsamadığı belgede yazmıyor. AB bölgesi önerilir (veri AB'de kalır; eğitimde kullanılmaz). |
| `docs/security/DEPENDENCIES.md` | `cloud/` ayrı bir bağımlılık ağacıdır (yalnız geliştirme araçları: wrangler, vitest, workerd); siteye girmez. Worker yayınlanırsa onun denetimi de yazılmalı. |
| ADR-036 / ADR-017 | "Hiçbir şey cihazdan çıkmaz" cümleleri cihaz üstü yol için doğru kalır; bulut yolu ayrı ve isteğe bağlı olarak anılmalı. |
| CI (`.github/workflows/ci.yml`) | **Dokunulmadı.** `cloud/` sınamaları yerelde koşulur (`cd cloud && npm test`). İstenirse sonradan bağımsız bir iş olarak eklenebilir; mevcut hat buna bağlanmamalı. |

## Sınamalar (10 Ekim 2026, bu çalışma ağacında koşuldu)

| Ne | Sonuç |
|---|---|
| `cloud/harness` — `node --test harness/test/` (Node 20.18) | **32 / 32 geçti**: mutlu yol, sorgulama, sağlayıcı hatası, 429'da `Retry-After` ile ve 5xx'te üstel bekleme ile yeniden deneme, zaman aşımı, tavan aşımında yüklemeden önce durma, özel dosyanın reddi (açılmadan), anahtarın hiçbir çıktıda görünmemesi (anahtarı hata metnine koyan sunucuya karşı da), silme çağrısı (başarısız kayıtta da), onaysız gerçek adrese istemci kurulamaması, kuru çalıştırmanın anahtar dosyasını açmaması; gerçek ffmpeg ile depodaki 9,6 sn'lik klipten yalnız-ses Ogg üretimi |
| `cloud/worker` — `vitest` + `@cloudflare/vitest-pool-workers` 0.22.0 (workerd, gerçek Durable Object) | **22 / 22 geçti**: kapalı doğma, acil kapatma, CORS, davet, uçtan uca iş, büyük sonucun ayrıştırılmadan geçmesi, işin davete bağlılığı, ses olmayan içerik, süre/boyut sınırı, davet dakikası, tek iş, aylık tavan ve eşzamanlı yarış, gerçek sürenin yazılması ve askıya alma, sağlayıcı hataları, hız sınırı, defterde içerik bulunmaması, temizlik alarmı |
| `tsc --noEmit` (Worker) | hatasız |
| Web uygulaması | değişmedi; sınamaları bu çalışmada yeniden koşulmadı |

## Ek, 11 Ekim 2026 — ilk gerçek ölçüm

Kurucunun onayıyla ve kendi çalıştırmasıyla (`cloud/harness/run.mjs`, AB bölgesi, universal-3-5-pro,
konuşmacı etiketleri açık, yalnızca açık lisanslı sesler). 12 dosya, 115,7 dakika, 19,61 MB yalnız ses
yüklendi; ücretsiz krediden 0,444 $ harcandı; 12 kaydın 12'si sağlayıcıda silindi; 90 istek, 0 yeniden
deneme. Ham rapor depoya girmez (`cloud/harness/results/2026-10-11T10-34-21-316Z/`).

Cihaz üstü sütunlar ADR-036'nın 7–8 Ekim doğrulama (`rval`) sayılarıdır; yeniden ölçülmedi. WER normalize.

| Dosya | Cihazda `base` | Cihazda `turbo` | AssemblyAI | Konuşmacı (bulunan / beklenen) | Süre |
|---|---|---|---|---|---|
| Çağrı 4474229 (51 dk) | %14,7 | %11,1 | %9,3 | 4 / 4 | 38,4 sn |
| Çağrı 4481221 (aksan, 21 dk) | %15,7 | %10,9 | %7,5 | 6 / 6 | 22,0 sn |
| Toplantı IS1009a, yaka mikrofonları | %25,5 | %21,9 | %19,1 | 4 / 4 | 15,5 sn |
| Aynı toplantı, uzak mikrofon | %34,2 | %25,8 | %23,3 | 4 / 4 | 20,7 sn |
| Toplantı + müzik | %54,8 | %22,4 | %15,1 | 2 / 3 | 14,6 sn |
| Konuşmaya bitişik müzik | %2,9 | %2,0 | %2,0 | 1 / 1 | 10,9 sn |
| İki kişi üst üste (LibriSpeech karışımı) | — | — | %12,8 | 2 / 2 | 15,2 sn |
| Japonca okuma (FLEURS) | — | — | CER %4,5 | 3 / ? | 11,3 sn |
| Türkçe MediaSpeech (5 dk) | — | — | katı %13,5 | 1 / ? | 10,8 sn |
| Türkçe okuma / müzikli (10 sn) | — | — | katı %21,4 / %15,0 | 1 / 1 | ≈4 sn |

Okuma:
- Doğruluk farkı var ama küçük: `turbo`'ya göre 2–7 puan; en büyük fark `base`'e ve müzik altındaki
  konuşmaya karşı. Kalabalık toplantıda bulut da %19–23 hata yapıyor.
- Asıl fark hız (51 dakika 38 saniyede) ve konuşmacı etiketleri; ayrıca WebGPU gerektirmemesi.
- Müzik altında kelime bitiş zamanı p95 1561 ms (eşik 250 ms): altyazı zamanlaması için zayıf nokta.
- Türkçe ve Japonca sayılar üst sınırdır (sayı/yazım normalleştiricisi yok).
- Doğrulananlar: ücretsiz hesap AB uç noktasını kullanabiliyor; silme çağrısı çalışıyor.
- Ölçülmeyenler: gerçek Türkçe ve Japonca sohbet, çeviri, `audio_end_at` faturalaması, Worker'ın
  gerçek Cloudflare'deki davranışı.

## Ek, 11 Ekim 2026 — istemci yapıldı, KAPALI doğar

> Bu çalışmada da AssemblyAI'ye, Cloudflare'e ya da başka bir dış hizmete **tek bir istek
> gitmedi**; hiçbir şey yayınlanmadı; `cloud/.env` okunmadı. İstemci, vekil sunucunun **yerel bir
> sahtesine** (`cloud/fake-worker/`, 127.0.0.1) karşı yazıldı ve sınandı. Gerçek Worker'ın,
> gerçek sağlayıcının ve gerçek bir telefonun davranışı **doğrulanmadı** (en altta).

### Kurucu kararı: rıza ekranı B, "İki yol yan yana"

"Yazıya dök" sihirbazında, yazıya dökme başlamadan önce tek ekran — **"Yazıyı nerede
çıkaralım?"** — ve eş ağırlıkta iki kart: **Cihazımda** ("Hiçbir şey gitmez. Daha yavaş, biraz
daha az doğru. Kimin konuştuğunu ayırmaz." → "Cihazımda yaz") ve **İnternette** ("Daha doğru,
çok daha hızlı. Kimin konuştuğunu da ayırır." + dört olgu + "Yaklaşık N dakika sürer · X dakika
düşer, Y dakikan kalır" → "Sesi gönder ve yaz"). Altında gizlilik sayfası bağlantısı. Yukarıdaki
"Rıza ekranı" bölümündeki metin önerisinin yerini bu aldı; kurallar aynen bağlayıcıdır. Taslak,
taslaktan farklar ve ekran görüntüleri: `docs/ux/2026-10-11-cloud-consent/`.

### Tek ayar, varsayılan boş

`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` — vekil Worker'ın kökeni, **derleme anında**. Boşken (yayındaki
site, CI, bugünkü her derleme):

- seçim ekranı yoktur; sihirbaz eskisiyle aynıdır (model adımı → Yazıya dök);
- `connect-src 'self'` aynen kalır; başka kökene `fetch`, XHR, beacon ve WebSocket tarayıcı
  tarafından engellenir (sınandı: yanında dinleyen bir sunucu hiçbir şey almadı);
- bulut yolunun **kodu derlemede yoktur** — "ulaşılamaz" değil, yok: `scripts/apply-csp.mjs`
  ayarsız bir durağan çıktıda `/v1/jobs`, `/v1/quota` ya da `AssemblyAI` bulursa derlemeyi
  durdurur; bulut cümleleri ayrı bir tabloda (`web/src/i18n/cloudMessages.ts`) durur ve sayfalara
  girmez;
- gizlilik sayfası bugünkü cümlelerini söyler ("hiçbir sunucuya gönderilmez").

Verildiğinde: tek bir `https://…` kökeni olmalıdır (yol, sorgu, joker, kimlik bilgisi, `http`
derlemeyi durdurur — `web/scripts/lib/cloudOrigin.mjs`); `connect-src` **yalnızca o kökeni**
kazanır (sağlayıcının adresi hiç eklenmez); seçim ekranı ve gizlilik sayfasının bulut bölümü gelir.

### Bu çalışmada verilen kararlar

| Konu | Karar | Neden |
|---|---|---|
| Rızadan önce giden istek | Kayıtlı davet kodu **yoksa** ekran hiçbir istek atmaz. Varsa yalnızca kalan dakikayı sorar (`GET /v1/quota`, kod `Authorization` başlığında; adreste asla). Ses, "Sesi gönder ve yaz"a basılmadan çıkmaz. | Karttaki "X dakika düşer, Y dakikan kalır" satırı Worker'ın cevabıdır. Gizlilik sayfası bunu söyler. |
| Seçimin hatırlanması | Hatırlanmaz; her videoda soru yeniden gelir, hiçbir kart işaretli değildir. Tarayıcıda tutulan tek şey davet kodudur. | Bağlayıcı kural. |
| Davet kodu | `localStorage` → `clip.cloudInvite`. Yalnızca "Kodu kaydet"e basılınca **ve Worker kodu kabul edince** yazılır; biçime uymayan kod hiçbir yere gönderilmez. Kartların altında ve gizlilik sayfasında "Davet kodunu kaldır". Geri çekilmiş kod bir sonraki açılışta silinir ve söylenir. | Çocuk için tek seferlik giriş; kod bir sır olduğu için adreste taşınmaz. |
| Ses dosyası | Videonun sesi, cihaz üstü tanıyıcının okuduğu aynı akıştan (16 kHz, tek kanal, videonun kendi saatinde) **yeniden kodlanır**: Opus, 24 kbit/s, WebM. Kaynak dosyadan hiçbir şey kopyalanmaz (görüntü, öbür izler, başlık/konum/cihaz/tarih etiketleri, dosya adı). Opus kodlayıcısı yoksa AAC 32 kbit/s, MP4; o da yoksa "bu tarayıcı hazırlayamıyor" denir. | Ölçümde gönderilen biçim; kelime zamanları doğrudan video zamanıdır. Worker'ın tür ve ilk bayt denetimi ikisini de kabul ediyor — Worker'da tür denetimi değişmedi. |
| Boyut | Ölçülen: **≈ 0,21 MB/dakika** (24 sn'lik örnek 85 KB; 10 dakikalık sessiz ton 2,12 MB). 120 dakika ≈ **25,5 MB** (Worker sınırı 95 MB; hız sınırı 64 kbit/s, ölçülen ≈ 28 kbit/s). | Yukarıdaki 21,6 MB tahmini kapsayıcı yükünü saymıyordu (WebM, 20 ms'lik her Opus çerçevesine birkaç bayt ekler). Konuşmayla ölçülmedi. |
| Satır kuralları | Sağlayıcının kelimeleri "kesim"lere ayrılır: **konuşmacı değişince** ya da kelimeler arasında **1,0 sn'den uzun** boşluk olunca yeni kesim (ölçüm düzeneğiyle aynı boşluk). Kesimin içinde cihaz üstü satır kuralları aynen uygulanır (`subtitleSegmentation.ts`: 2 × 32 karakter, cümle sonu, 0,5 sn duraklama, 6 sn). | Panel, arama, "Bunlardan kesit yap", altyazı ve SRT/VTT değişmeden çalışır; bir satır iki kişinin sözünü taşımaz. |
| "(anlaşılamadı)" | Bulut sonucunda yoktur. | Sağlayıcı "duydum ama yazamadım" bilgisi vermiyor; uydurulmadı. |
| Konuşmacı etiketleri ve şema | **EDL v4 değişmedi.** Konuşmacı tarife yazılmaz. Sonuç ekranında ses değiştiği satırda "1. kişi / 2. kişi" görünür, metin dosyasına da yazılır; bu bilgi açık sihirbazla birlikte yaşar. Editöre geçince ve sayfa yenilenince etiketler yoktur (satır sınırları kalır). | Şema v5, yol **kapalıyken** herkesin kayıtlı tarifini ve yedek dosyalarını değiştirirdi ("kapalı derleme bugünküyle aynı davranmalı"). Yol açılırken v5 (satıra `speaker`) önerilir — kurucu kararı. |
| Dil | Worker'a dil gönderilmez (otomatik algılama); izin dili sağlayıcının söylediğidir (`tr`, `en-US`…). | Cihaz üstü yol yalnız İngilizce; bulut yolunun farkı. |
| "İnternette yazıldı" etiketi | Sonuç ekranında ve metin dosyasının başlığında; tarife yazılmaz. Editörün "Yazı" paneli aynı izi "Otomatik yazıldı — yanlış olabilir" diye gösterir. | Şema değişmediği için. |
| Süre tahmini | `20 sn + ses dakikası × 0,75 sn`, tam dakikaya yukarı: 11 Ekim ölçümündeki 12 koşunun hepsinin üstünde. 53 dakikaya kadar "Yaklaşık 1 dakika", 120 dakikada 2. | Sesin cihazda hazırlanması ve yavaş bağlantı dahil **değil** (ölçülmedi). |
| Cihaz kartındaki süre | Sayı yok: "Konuşmanın süresinin yarısı kadar sürebilir; yavaş cihazda daha uzun." | Her cihaz için dürüst bir tahminimiz yok (ADR-036 cümlesi). |
| Vazgeçme | 15 dakika (ya da tahminin on katı) sonuç gelmezse iş bırakılır ve silinir. Birkaç kayıp durum sorgusu affedilir (≈ 9 sn), sonra "ulaşamadık". | Takılı kalan bekleme olmaz. |
| Editördeki "Videoyu yazıya dök" | Yalnız cihaz üstü; bulut yolu sihirbazdadır. | Kapsam: karar sihirbaz içindi. |
| Politika | `15_PRICING_FREE_PRO.md` ve `policy.ts` **değişmedi**; `policy.test.ts` bir cümle istemedi. | Bulut dakikasının ücretli/ücretsiz olması açık kurucu kararı. |

### Worker'da değişenler (`cloud/worker/`, yayınlanmadı)

1. **`x-job-id`** (isteğe bağlı, UUID): tarayıcı işi kendisi adlandırır. Böylece yarıda kesilen
   bir yüklemeyi ya da yanıtı kaybolan bir başlatmayı `DELETE /v1/jobs/:id` ile geri verebilir;
   yoksa aynı davet 30 dakika (çalışan iş için 24 saate kadar) "başka iş sürüyor" derdi. Var olan
   bir ad kimin olursa olsun reddedilir (`job_id_taken`); biçimsiz ad `bad_job_id`.
2. **Yükleme sürerken silinen iş** için sağlayıcıda kayıt açılmaz (`409 job_canceled`). Son anda
   silinen işin kaydı sağlayıcıda hemen silinir; silinemezse kimliği işte tutulur ve temizlik
   alarmı siler (önceden bu kayıt sahipsiz kalabilirdi).
3. **Silme, durum çağrısına bağlı değil:** sağlayıcının durumu okunamasa da `DELETE` kaydı siler
   (önceden 502 ile bitiyordu).
4. Tür denetimi, sınırlar, tavan, hız sınırı, defterde tutulanlar: **değişmedi.**

**Sözleşme ve sahte sunucu.** `cloud/contract/cases.mjs` tarayıcıya bakan API'yi 18 durumla
anlatır; aynı liste hem workerd içindeki **gerçek Worker koduna** (`worker/test/contract.test.ts`)
hem web sınamalarının konuştuğu **sahte Worker'a** (`fake-worker/test/contract.test.mjs`) koşar.
Worker'ın cevabı değişirse sahte de aynı durumda kırılır; web sınamaları var olmayan bir API'ye
kayamaz.

### Bilinen sınır: işi başlamamış yükleme bizim elimizle silinemiyor

Sağlayıcının API'si yüklenen sesi yalnızca **kaydıyla birlikte** siliyor. Yükleme sırasında
durdurulan (ya da bağlantısı kopan) bir işte kayıt açılmadığı için silecek bir şey yoktur; o ana
kadar sağlayıcıya ulaşmış ses, sağlayıcının kendi kuralıyla silinir ("24 saatte başlar, en çok 48
saat" — yukarıdaki belge alıntısı). Ekran bu durumda "silindi" demez; şunu söyler: "Yazma işi
durduruldu. Gönderilen sesten orada kalan olduysa, AssemblyAI bunu en geç iki gün içinde
sildiğini söylüyor." Karttaki "Yazı gelince oradaki ses ve yazı silinir" cümlesi olağan yol
içindir ve o yolda doğrudur.

### Hata iletileri (hepsi "Cihazımda yaz"ı bir basış uzakta bırakır)

| Ne oldu | Ekranda |
|---|---|
| Vekile ulaşılamadı (kartta) | İnternetteki yazıcıya ulaşamadık. İnternet bağlantına bak; cihazında da yazabiliriz. + "Yeniden dene" |
| Vekile ulaşılamadı (iş sürerken) | İnternetteki yazıcıya ulaşamadık. İnternet bağlantına bakıp yeniden dene ya da cihazında yaz. |
| Kapalı / aylık tavan doldu | Şu an internette yazamıyoruz. Cihazında yazabiliriz. |
| Davet kodu biçimsiz | Bu bir davet koduna benzemiyor. Kod, tireyle ayrılmış dört grup harf ve rakamdır. |
| Davet kodu geçersiz (girerken) | Bu davet kodu geçmiyor. Kodu kontrol edip yeniden yaz. |
| Kayıtlı kod geri çekilmiş | Kayıtlı davet kodun artık geçmiyor. Yeni bir kod yazabilirsin. |
| Kod kontrol edilemedi | Kodu kontrol edemedik: internetteki yazıcıya ulaşamadık. İnternet bağlantına bakıp yeniden dene. |
| Kod iş başlarken reddedildi | Davet kodun geçmiyor. Yeni bir kod yaz ya da cihazında yaz. |
| Dakika yetmiyor (kartta) | Bu videonun sesi X dakika; Y dakikan kaldı. Yetmiyor. Cihazında yazabiliriz. |
| Dakika yetmiyor (iş başlarken) | Dakikan bu video için yetmiyor. Cihazında yazabiliriz. |
| Ses çok uzun (kartta) | Bu video çok uzun: internette en çok N dakikalık ses yazılabiliyor. Cihazında yazabiliriz. |
| Ses çok uzun (iş başlarken) | Bu video internette yazmak için çok uzun. Cihazında yazabiliriz. |
| Aynı davetle başka iş sürüyor | Bu davet koduyla başka bir yazma işi sürüyor. Bitince yeniden dene ya da cihazında yaz. |
| Çok sık deneme | Çok sık denendi. Bir süre sonra yeniden dene ya da cihazında yaz. |
| Yükleme yarıda kesildi | Gönderme yarıda kesildi; yazı çıkmadı. İnternet bağlantına bakıp yeniden dene ya da cihazında yaz. |
| Sağlayıcı hata verdi (yükleme, başlatma, kayıt, durum, sonuç) | Olmadı: internetteki yazıcı bu sesi yazamadı. Yeniden dene ya da cihazında yaz. (Sağlayıcının metni ekrana geçmez.) |
| Sonuç boş | Yazı boş geldi: bu seste yazıya dökülecek konuşma bulunamadı. İstersen cihazında dene. |
| Çok uzun sürdü | Çok uzun sürdü, durdurduk; yazı çıkmadı. Yeniden dene ya da cihazında yaz. |
| Tarayıcı sesi hazırlayamıyor | Bu tarayıcı videonun sesini gönderilecek hâle getiremiyor; hiçbir şey gönderilmedi. Cihazında yazabiliriz. |
| Videonun sesi okunamadı | Bu videonun sesi okunamadı; hiçbir şey gönderilmedi. Cihazında deneyebilirsin. |
| Beklenmeyen | Bir şey ters gitti; yazı çıkmadı. Yeniden dene ya da cihazında yaz. |
| Kullanıcı durdurdu | Durduruldu; yazı çıkmadı. |

Ses gönderilmişse iletinin altına ne olduğu da yazılır: "Gönderilen ses oradan silindi." (iş
başlamıştı ve silme çağrısı başarılı) · yukarıdaki "Yazma işi durduruldu…" cümlesi (iş
başlamamıştı) · "Gönderilen sesi şimdi silemedik; sunucumuz silmeyi kendiliğinden yeniden dener."
(silme çağrısı yapılamadı). Vekilin kapısında reddedilen işte (davet, dakika, kapalı, tek iş, hız
sınırı) hiçbir şey sağlayıcıya geçmediği için böyle bir cümle çıkmaz.

### Sınamalar (11 Ekim 2026, bu çalışma ağacında koşuldu; hepsi yerel)

| Ne | Sonuç |
|---|---|
| `cloud/harness` — `node --test harness/test/` | **39 / 39** |
| `cloud/worker` — vitest + workerd, gerçek Durable Object | **43 / 43** (25 + 18 ortak sözleşme durumu); `tsc --noEmit` hatasız |
| `cloud/fake-worker` — `node --test fake-worker/test/` | **23 / 23** (aynı 18 sözleşme durumu + sahteye özgü 5) |
| Web: `tsc --noEmit`, `eslint .` | hatasız |
| Web birim (vitest) | **1276 / 1276** (75 dosya; 39'u yeni: `cloudTranscript.test.ts`, `cloudBuild.test.ts`) |
| Web e2e, olağan derleme (yol **kapalı**; `CLIP_TEST_HOOKS=1`) | Son kodda 362 sınama: **358 geçti, 4 atlandı, 0 başarısız** (atlananlar: 2 ekran görüntüsü, 2 gerçek-model sınaması — model dosyaları yok). Bir önceki tam koşuda 357 geçti / 1 başarısız: başarısız olan bu çalışmanın yeni sınamasıydı (`cloud-off.spec.ts`, `sendBeacon`'ın dönüş değerine bakıyordu; tarayıcı işareti kuyruğa alıp sonra engelliyor). Sınama, dinleyen sunucunun hiçbir şey almadığına bakacak biçimde düzeltildi; uygulama kodu iki koşu arasında değişmedi. |
| Web e2e, bulut derlemesi, yerel sahte Worker'a karşı (`playwright.cloud.config.ts`) | **36 / 36** (+ tasarım kaydı için 4 ekran görüntüsü betiği) |
| Durağan çıktı, varsayılan (`STATIC_EXPORT=1`, `/capcut`) | derlendi; 17 sayfanın hepsinde `connect-src 'self'`; çıktıda bulut kodu ve cümlesi yok (`pages-smoke.spec.ts`'in yeni sınaması geçti) |
| Durağan çıktı, ayar verilmiş (`https://lilocut-transcript-proxy.example.workers.dev`, yer tutucu; istek atılmadı) | derlendi; 17 sayfanın hepsinde `connect-src 'self' https://lilocut-transcript-proxy.example.workers.dev`; sayfaların politikasında başka hiçbir köken yok; `pages-smoke.spec.ts`'in bulut sınaması aynı ayarla geçti |
| Biçimsiz ayar (`http://…/v1`) | derleme durdu ("must be one origin…") |
| Pages duman sınaması (varsayılan çıktı, model dosyaları olmadan) | 8 sınama: 4 geçti, 2 atlandı (model), **2 başarısız — ikisi de bu çalışmadan bağımsız**: biri "Dikey yap"tan hâlâ 1080 × 1920 bekliyor (ADR-041'den beri 640 × 1138), öbürü `NEXT_PUBLIC_SUPPORT_CONTACT` verilmeden derlenen çıktıda destek bağlantısını arıyor (CI bu değişkeni verir) |
| `npm run quality` | 625 ölçü: **547 bütçe içinde, 9 dışında**, 5 ölçülemedi (model dosyaları yok), 64 bütçesiz. Dışındakilerin sekizi önceki koşudakilerdir (yedisi arama, biri dizinin sonda olması); **yenisi**: rıza ekranının kurucu onaylı "AssemblyAI adlı şirketin Avrupa'daki bilgisayarlarına gider." cümlesi okunabilirlikte "çok zor" çıkıyor (metne dokunulmadı, bütçe gevşetilmedi — `docs/quality/bulgular.md`). Var olan ekran tabanlarının hiçbiri değişmedi; bulut yürüyüşü için 10 yeni taban. Rapor: `docs/quality/latest.md` (bulut satırları "sahte sunucuya karşı" etiketli) |

### Doğrulanmayanlar (bu ek için)

- **Gerçek Worker.** CORS ön uçuşu, `x-job-id`, akıtılan gövde, istemcinin bağlantıyı kesmesinin
  Worker'da nasıl göründüğü, 10 ms işlemci sınırı — hiçbiri gerçek Cloudflare'de çalışmadı.
  Sözleşme workerd'de geçiyor; gerçek ağ geçmedi.
- **Gerçek sağlayıcı bu dosyayla.** Ölçümde sağlayıcıya ffmpeg'in ürettiği Ogg/Opus gitti;
  tarayıcının ürettiği **WebM/Opus** (ve AAC/MP4) dosyasını kabul ettiği, kelime zamanlarının
  video zamanıyla örtüştüğü (Opus ön atlaması birkaç ms'dir) **sınanmadı**.
- **Opus kodlayıcısı olmayan tarayıcılar.** Yedek yol (AAC, MP4) bu makinedeki Chromium'da
  denenemedi: 16 kHz tek kanal AAC kodlayıcısı yok; sınama bunu görür ve "hazırlanamıyor" iletisini
  doğrular. Safari ve Firefox'ta ses hazırlama hiç denenmedi.
- **Gerçek telefon.** Sesin hazırlanma süresi, bellek, arka plana alınan sekme, mobil ağda yükleme
  ilerlemesi, sekme kapanırken giden silme isteği (`keepalive`).
- **Boyut ve süre, konuşmayla.** 0,21 MB/dakika sessiz bir tonla ve 24 sn'lik deneme sesiyle
  ölçüldü. "Yaklaşık N dakika" sağlayıcının 11 Ekim'deki hızına dayanır; cihazdaki hazırlık ve
  yükleme süresi eklenmedi.
- **Uzun dosya.** 120 dakikalık bir videonun sesi tarayıcıda uçtan uca hazırlanmadı (en uzun
  deneme 10 dakika).
- **Kalite.** Sahte sunucu konuşmayı duymaz. Yazının doğruluğu için tek kaynak yukarıdaki 11 Ekim
  ölçümüdür; bu çalışmanın hiçbir sayısı doğruluk hakkında bir şey söylemez.

### Yayın için yapılacaklar (kurucu; sırayla)

1. **Worker'ı yayınla** (`cloud/worker/README.md`; wrangler Node 22 ister): `wrangler deploy`,
   `wrangler secret put ASSEMBLYAI_API_KEY`, `wrangler secret put ADMIN_TOKEN`. Değişkenler:
   `ENABLED=true`, `MONTHLY_CAP_USD` (öneri 1), `ALLOWED_ORIGINS` içinde sitenin kökeni
   (`https://erenulutas0.github.io` hazır), `PROVIDER_REGION=eu` (**ekran "Avrupa'daki
   bilgisayarlar" diyor; `us` yapılırsa ekran ve gizlilik metni yalan söyler**).
2. **Davet kodu üret:** `curl -X POST https://<worker>/admin/invites -H "Authorization: Bearer <ADMIN_TOKEN>" -d '{"label":"…","minutes":60}'`.
3. **Siteye köken ver:** GitHub → depo → Settings → Secrets and variables → Actions →
   **Variables** → `CLOUD_TRANSCRIPT_URL = https://<worker-kökeni>` (yol ve sondaki `/` olmadan).
   `.github/workflows/ci.yml` bu değişkeni Pages derlemesine ve duman sınamasına
   `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` olarak geçirir; değişken yokken boştur (yol kapalı).
   Yerelde denemek için: `$env:NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL='https://…'; npm run build`.
4. **Bak:** yayından sonra `/gizlilik` sayfasında "İnternette yazıya dökme" bölümü görünmeli;
   sayfa kaynağındaki `connect-src` tam olarak `'self' https://<worker-kökeni>` olmalı.
5. **Kapatmak:** değişkeni sil ve yeniden yayınla (ekran ve kod gider) — ya da hemen, yayın
   beklemeden: `POST /admin/kill {"on":true}` (kart "Şu an internette yazamıyoruz" der).

### Kurucu kararları gerekiyor (bu ek için)

1. **Cihaz kartına eklenen "Şimdilik yalnızca İngilizce."** — onaylanan metinde yoktu; kalsın mı?
2. **Konuşmacı etiketleri kalıcı olsun mu?** Evetse EDL v5 (satıra `speaker`), yol açılırken.
   Bugün: yalnız açık sonuç ekranında ve metin dosyasında.
3. **İşi başlamamış yükleme** (yukarıdaki sınır): ekranın söylediği cümle yeterli mi; yoksa
   Worker durdurulan yükleme için kaydı açıp hemen silsin mi (sağlayıcının bunu nasıl
   faturaladığı bilinmiyor)?
4. **Bulut dakikası ücretsiz mi, ücretli mi, deneme mi** — politika belgesi 15 buna göre
   yazılacak; bugün dokunulmadı.
5. **Veri sorumlusu (K02).** Gizlilik sayfasının bulut bölümü "davetli deneme; veri sorumlusu
   belirlenmedi" diyor. Belirlenmeden deneme dışına açılmamalı.
6. **CI'da bulut sınaması:** bugün koşuyor ama yayını **durdurmuyor** (`continue-on-error`); yol
   açıldığında durdurmalı mı?
7. **Gerçek doğrulama sırası:** önce kurucunun kendi telefonunda, kendi davet koduyla, tek bir
   kısa videoyla (bedeli < 0,01 $) uçtan uca deneme önerilir — yukarıdaki "Doğrulanmayanlar"ın
   ilk dördünü kapatır.

## Doğrulanmayanlar (10 Ekim taslağı)

- **Sağlayıcının kendisi:** doğruluk, hız, gerçek hata metinleri, hız sınırı davranışı — hiçbiri
  ölçülmedi (istek atılmadı). Sahte sağlayıcı yalnız belgelenen şekilleri taklit eder.
- Ücretsiz hesabın **AB uç noktasını** kullanıp kullanamadığı; AB'de "eğitimde kullanılmaz"ın
  ücretsiz hesap için de geçerli olduğu (belge plan ayrımı yapmıyor).
- `audio_end_at` verilen işin neye göre faturalandığı ve `audio_duration`'ın hangi süreyi bildirdiği.
- Hız sınırında dönen kod: SSS sayfası "HTTP 403" diyor (5 dakikada 20 000 istek), API başvurusu
  `429` + `Retry-After` listeliyor. Düzenek 429 ve 5xx'te yeniden dener, 403'te denemez.
- Silinen kaydın yanıt şekli; sonuçtaki `speech_model_used` alan adı.
- Konuşmacı ayrımının Türkçe ve Japoncada desteklenip desteklenmediği (sayfa dil listesi vermiyor).
- Saklama süresi belgeleri kendi içinde tutarsız (eski bir SSS "süresiz" diyor; güncel sayfa 30 gün).
- Opus 24 kbit/s'in doğruluğa etkisi (sağlayıcı "özgün biçimde gönderin" öneriyor).
- ~~Tarayıcının yalnız-ses Opus dosyasını üretebilmesi (WebCodecs + `mediabunny`)~~ — 11 Ekim: Chromium'da üretildi ve ffprobe ile doğrulandı (tek ses izi, Opus, tek kanal); başka tarayıcılar ve sağlayıcının bu dosyayı kabulü hâlâ doğrulanmadı (yukarıdaki ek).
- Worker gerçek Cloudflare'de hiç çalışmadı: 10 ms işlemci sınırı, Free planda alarm, akıtılan
  gövde. `wrangler deploy --dry-run` da koşulamadı (bu makinede Node 20; wrangler 22 istiyor).
- Cloudflare sınırları `developers.cloudflare.com` yerine belgelerin kaynak deposundan okundu
  (`github.com/cloudflare/cloudflare-docs`, `production`: `workers/platform/limits.mdx`,
  `partials/durable-objects/durable-objects-pricing.mdx`, `kv/platform/limits.mdx`,
  `workers/runtime-apis/bindings/rate-limit.mdx`); site araçtan açılamadı.
- Çeviri için sağlayıcı dışı seçeneklerin fiyatı.

## Kurucu kararları gerekiyor

1. **Aylık tavan** kaç dolar? (Öneri: deneme için 1 $ ≈ 260 dakika. 0 = kapalı.)
2. **Davet kimlere** verilecek, kaç kişi? (Her davet, en kötü durum hesabındaki çarpandır.)
3. **Davet başına dakika** (öneri 60) ve iş başına en çok süre (öneri 120 dk).
4. **Ölçümde kendi özel videoların kullanılsın mı?** (Öneri: hayır — ücretsiz planda eğitimden
   çıkma yok; açık lisanslı küme yeterli. Evetse yalnız AB bölgesiyle ve `--allow-private` ile.)
5. **Bölge: AB mi ABD mi?** (Öneri: AB — veri AB'de kalır ve belgeye göre eğitimde kullanılmaz.)
6. **Model katmanı:** Universal-3.5 Pro (0,21 $/sa) mı, Universal-2 (0,15 $/sa) mı; konuşmacı
   ayrımı (+0,02) açık mı? (Öneri: ölçümde ikisi de; üründe ölçüm sonucuna göre.)
7. **Ölçüm kümesi:** aksanlı çağrı dahil mi (0,41 $ / 0,33 $); eksik dosyalar (Türkçe sohbet,
   Japonca, iki kişilik üst üste konuşma) üretilsin / bulunsun mu; FLAC karşılaştırması yapılsın mı?
8. **Çeviri** kapsamda mı (+0,06 $/sa), hangi dillere?
9. **Sonuç sağlayıcıda ne kadar bekleyebilir?** (Öneri: sonuç alınınca hemen sil; alınmazsa 60 dk.)
10. **Veri sorumlusu (K02)** ve gizlilik iletişim adresi — davetli deneme dışına açılmadan önce.
11. Sağlayıcı hesabına **kart eklenmeyecek** kuralı deneme boyunca sürüyor mu? (Kart eklendiği
    an "kredi bitince API durur" güvencesi kalkar; tavanın en kötü durumu gerçek paraya döner.)
12. Ölçüm için "başla" onayı — hangi kayıtlar, hangi bölge.
