# ADR-039 — Bulut yazıya dökme yolu (isteğe bağlı, davetli): yalnız ses çıkar, anahtar bir Worker'da durur

> Tarih: 10 Ekim 2026 · Durum: **ÖNERİ / TASLAK** — hiçbir şey yayında değil, politika değişmedi
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

## Doğrulanmayanlar

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
- Tarayıcının yalnız-ses Opus dosyasını üretebilmesi (WebCodecs + `mediabunny`) — arayüz yapılmadı, denenmedi.
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
