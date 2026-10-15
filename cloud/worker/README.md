# Bulut yazıya dökme vekili (Cloudflare Worker) — kurulum ve işletme

> Durum: **yayında değil.** Kod yazıldı ve yerelde sınandı (sahte sağlayıcıyla); gerçek sağlayıcıya
> tek bir istek gitmedi, Cloudflare'e hiçbir şey yüklenmedi. Karar ve gerekçe:
> [`docs/adr/ADR-039-cloud-transcript-route.md`](../../docs/adr/ADR-039-cloud-transcript-route.md) (taslak).
>
> **Kurucu için:** aşağıdaki giriş ve gizli anahtar adımlarını yalnızca sen yapabilirsin; ben
> (ajan) hiçbir hesaba giriş yapamam, hiçbir anahtarı yazamam.

## Bu ne işe yarar

Site durağan dosyalardan oluşur; içinde sır saklanamaz. Bu yüzden tarayıcı sağlayıcıyla
(AssemblyAI) doğrudan konuşmaz: sesi bu Worker'a yollar, Worker anahtarı kendi kasasından
(`wrangler secret`) ekleyip sağlayıcıya iletir.

| Uç | Ne yapar |
|---|---|
| `POST /v1/jobs` | Başlat. İsteğin gövdesi ses dosyasının kendisidir; Worker onu **belleğe almadan** sağlayıcıya akıtır. |
| `GET /v1/jobs/:id` | Durum (`uploading`, `queued`, `processing`, `completed`, `error`). Metin içermez. |
| `GET /v1/jobs/:id/result` | Yazıyı sağlayıcıdan olduğu gibi geçirir; tarayıcı hepsini alınca sağlayıcıdaki kayıt **silinir**. |
| `DELETE /v1/jobs/:id` | Sağlayıcıdaki kaydı hemen siler. |
| `GET /v1/quota` | Bu davet kodunun kalan dakikası; bulut yolu açık mı. |
| `/admin/*` | Yalnız kurucu (`ADMIN_TOKEN`): davet kodu, harcama, acil kapatma. |

## Ücretsiz planla çalışır mı? Evet — ücretli hiçbir ek yok

Kullanılan her şey Workers **Free** planında var (Cloudflare belgeleri, 10 Ekim 2026'da okundu;
`developers.cloudflare.com` araçtan açılamadığı için belgelerin kaynağından —
`github.com/cloudflare/cloudflare-docs`, `production` dalı — okundu):

| Sınır (Free) | Değer | Bizim için anlamı |
|---|---|---|
| İstek | 100 000 / gün | Bir iş ≈ 1 başlatma + ~20 durum sorgusu + 1 sonuç. Sınır aşılırsa Worker o gün yanıt vermez (para kaybı olmaz; cihaz üstü yol çalışmaya devam eder). |
| İşlemci süresi | istek başına 10 ms | Ses akıtılır, ayrıştırılmaz; büyük sonuç JSON'u çözülmeden geçirilir. **Gerçek Cloudflare'de ölçülmedi** (aşağıda "Doğrulanmayanlar"). |
| Bellek | 128 MB | Dosya belleğe alınmaz. |
| İstek gövdesi | **100 MB** (Free ve Pro hesap) | 120 dakikalık ses, 24 kbit/s Opus ile ≈ **21,6 MB**; kabul edilen en yüksek hız 64 kbit/s'de ≈ 57,6 MB. İkisi de sınırın altında. Worker ayrıca 95 MB'tan büyüğünü reddeder. |
| Alt istek | istek başına 50 | Başlatma 4 alt istek yapar. |
| Durable Object | Free'de **yalnız SQLite destekli** olan; 100 000 istek/gün, 13 000 GB-sn/gün, 5 M satır okuma/gün, 100 000 satır yazma/gün, 5 GB | Defter budur. Bir iş ≈ 10 satır yazar. |
| KV, D1, R2, Queues, ücretli Rate Limiting | **kullanılmıyor** | — |

Durable Object ücretli plan **gerektirmiyor**: Free plan yalnızca SQLite destekli sınıflara izin
verir, biz de onu kullanıyoruz (`wrangler.jsonc` → `new_sqlite_classes`).

## Para nereden sızabilir, ne durdurur

1. **Kapalı doğar.** `ENABLED` "true" değilse ya da `MONTHLY_CAP_USD` 0 ise her iş `503 cloud_off`
   alır; sağlayıcıya hiçbir şey gitmez. Depodaki değerler: `ENABLED=false`, `MONTHLY_CAP_USD=0`.
2. **Davet kodu şart.** Kod bir kez gösterilir; defterde yalnız SHA-256 özeti durur.
3. **Davet başına dakika** (varsayılan 60) ve **davet başına aynı anda tek iş.**
4. **Aylık kesin tavan (USD).** İş başlamadan önce, beyan edilen süreyle hesaplanan bedel
   ayrılır; "bu ay harcanan + ayrılmış + bu iş" tavanı aşıyorsa iş başlamaz. İş bitince
   sağlayıcının bildirdiği **gerçek süre** yazılır.
5. **IP başına saatte 10 deneme** (yanlış davet kodu denemeleri de sayılır — başlatmada ve kota
   sorgusunda; bilinen kodun kota sorgusu sayılmaz).
6. **İş başına en çok 120 dakika**; beyan edilen süreye göre fazla ağır dosya reddedilir
   (saniye başına en çok 8000 bayt + 64 KB).
7. **Ses olmayan içerik reddedilir:** `Content-Type` ses olmalı *ve* dosyanın ilk baytları o türe
   uymalı (ör. `audio/ogg` deyip MP4 yollayan reddedilir).
8. **CORS** yalnız sitenin adresine açık (`ALLOWED_ORIGINS`). Bu bir tarayıcı kuralıdır, kimlik
   doğrulama değildir; asıl kapı davet kodudur.
9. Sağlayıcıya "yalnız beyan edilen süre kadarını yaz" denir (`audio_end_at`); beyandan belirgin
   uzun çıkan dosya (%2 + 3 sn'den fazla) o davet kodunu **askıya alır**.

### Tavanın en kötü durumu (dürüst hesap)

- **Yarış yüzünden aşım: 0.** Defter tek bir Durable Object'tir; istekleri sırayla işler ve
  "tavanı denetle + ayır" tek adımdır. Sınama: aynı anda başlatılan beş işten tam ikisi kabul
  edildi, toplam ayrılan 0,92 $ (tavan 1 $). KV kullansaydık (yazma başka yerde 60 sn'ye kadar
  geç görünür, "oku-karşılaştır-yaz" yoktur) aşım eşzamanlı istek sayısıyla büyürdü; bu yüzden
  KV seçilmedi.
- **Süreyi yanlış beyan eden kullanıcı.** Beyan 120 dakika, dosya gerçekte daha uzunsa:
  sağlayıcı `audio_end_at`'e göre faturalıyorsa aşım ≈ 1 saniye; **tüm dosya süresine göre
  faturalıyorsa** (belgelerde yazmıyor — doğrulanmadı) bir iş en çok sağlayıcının 10 saatlik
  dosya sınırı kadar, yani en çok **10 sa × 0,23 $ = 2,30 $** yakar. İş bitince gerçek süre
  deftere yazılır, o davet askıya alınır ve tavan sonraki işleri durdurur. Yani en kötü durum:
  **(aynı anda hile yapan davet sayısı) × 2,30 $.**
- **Mutlak sınır, deneme döneminde:** sağlayıcı hesabında kart yoksa ücretsiz kredi bitince API
  durur ("API access is paused until you top up"); gerçek para çıkmaz. Kaybedilebilecek en fazla
  şey kalan ücretsiz kredidir.
- `PRICE_USD_PER_HOUR` elle yazılır. Model ya da konuşmacı ayrımı değişir de bu değer
  güncellenmezse tavan yanlış parayı sayar.

## Gizlilik: ne saklanır

Worker **ses saklamaz, yazı saklamaz, günlük tutmaz** (`observability` kapalı; kodda `console`
çağrısı yok). Durable Object'te duran her şey:

| Kayıt | İçerik | Ne kadar |
|---|---|---|
| Davet | kodun SHA-256 özeti, senin verdiğin etiket, dakika hakkı, kullanılan dakika, iptal durumu | sen silene kadar |
| İş | rastgele kimlik, davet özeti, sağlayıcının kayıt kimliği (**sağlayıcıda silinince boşaltılır**), beyan / ayrılan / gerçek saniye, bayt sayısı, durum, zaman damgaları | 90 gün (harcama denetimi), sonra silinir |
| Ay | harcanan tutar, iş sayısı, toplam saniye | kalıcı (kişisel veri değil) |
| Hız sınırı | IP adresinin **tuzlanmış özeti** + o saatin sayacı | içinde bulunulan saat; saat dolunca ilk temizlikte silinir (en çok ~70 dk) |

Ham IP adresi, dosya adı, ses, yazı, dil, davet kodunun kendisi **saklanmaz**. Etikete gerçek ad
yazma; "arkadaş-3" gibi bir şey yaz. Cloudflare'in kendi ağı isteği işlerken IP'yi görür; bu
onların politikasına tabidir, bizim kaydımız değildir.

Sağlayıcıdaki kayıt şu üç yoldan biriyle silinir: tarayıcı sonucu alınca (kendiliğinden),
tarayıcı `DELETE` deyince, ya da tarayıcı hiç dönmezse temizlik alarmıyla (sonuç hazır olduktan
60 dk sonra; her durumda en geç 24 saat). Silme çağrısı sağlayıcıda yüklenen ses dosyasını da
siler (AssemblyAI belgesi: "Files uploaded via the /upload endpoint are immediately deleted
alongside the transcript").

## Kurulum — adım adım (sonra, kendi başına)

Gerekenler: Node.js **22 ya da üstü** (`wrangler` komutu Node 20'de çalışmıyor; sınamalar Node
20'de de çalışır), Cloudflare hesabı (Free), AssemblyAI anahtarı.

```bash
cd cloud
npm ci

# 1) Cloudflare'e giriş — tarayıcı açılır, sen onaylarsın
npx wrangler login

# 2) Sırlar — değerler ekrana yazılmaz; ikisini de sen girersin
npx wrangler secret put ASSEMBLYAI_API_KEY --config worker/wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN        --config worker/wrangler.jsonc
#    ADMIN_TOKEN: en az 24 karakter, rastgele. Üretmek için:
#    node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
#    Bir parola yöneticisine kaydet; yönetim uçları onsuz yanıt vermez (404).

# 3) Yayınla. Durable Object (defter) ilk yayında kendiliğinden oluşur; ayrıca KV / D1 kurmak GEREKMEZ.
npx wrangler deploy --config worker/wrangler.jsonc
#    Çıktıdaki adresi not et: https://lilocut-transcript-proxy.<hesap-adın>.workers.dev
```

Bu noktada Worker yayındadır ama **kapalıdır** (`ENABLED=false`, tavan 0): her iş `503` alır.

### Açmak

`worker/wrangler.jsonc` içinde iki satırı değiştir ve yeniden yayınla:

```jsonc
"ENABLED": "true",
"MONTHLY_CAP_USD": "1",   // küçük başla; 1 $ ≈ 260 dakika (0,23 $/saat)
```

```bash
npx wrangler deploy --config worker/wrangler.jsonc
```

(Aynı iki değer Cloudflare panelinden de değiştirilebilir: Workers & Pages → lilocut-transcript-proxy →
Settings → Variables. Panelden yapılan değişiklik bir sonraki `wrangler deploy` ile dosyadaki
değere döner; kalıcı olması için dosyayı da değiştir.)

### Davet kodu eklemek

```bash
export W=https://lilocut-transcript-proxy.<hesap-adın>.workers.dev
export ADMIN='<ADMIN_TOKEN değerin>'

curl -s -X POST "$W/admin/invites" -H "authorization: Bearer $ADMIN" \
     -d '{"label":"arkadas-1","minutes":60}'
# → {"code":"ABCDE-FGHJK-MNPQR-STVWX","id":"3f9a…","label":"arkadas-1","minutes":60}
```

`code` yalnızca bu yanıtta görünür; kişiye onu verirsin. Kaybolursa yenisini üretirsin.
İptal: `curl -s -X DELETE "$W/admin/invites/<id>" -H "authorization: Bearer $ADMIN"`.

### Harcamayı görmek

```bash
curl -s "$W/admin/spend" -H "authorization: Bearer $ADMIN"
```

Ay, tavan, harcanan, ayrılmış, davet başına kullanılan dakika, sağlayıcıda hâlâ duran kayıt
sayısı (0 olmalı). Bu **bizim defterimizdir**; gerçek fatura/kredi için AssemblyAI panelindeki
Billing sayfasına da bak — ikisi uyuşmalı.

### Her şeyi anında kapatmak

Hızlıdan kesine doğru üç yol:

1. **Acil düğme (yeniden yayın gerekmez, saniyeler):**
   `curl -s -X POST "$W/admin/kill" -H "authorization: Bearer $ADMIN" -d '{"on":true}'`
   Yeni iş başlamaz. Süren işler sonuçlanır ve silinir. Geri açmak: `{"on":false}`.
2. **Değişken:** `ENABLED` → `"false"` (panelden ya da dosyadan + `wrangler deploy`).
3. **Kökten:** `npx wrangler delete --config worker/wrangler.jsonc` (Worker'ı kaldırır) ve/veya
   AssemblyAI panelinden API anahtarını iptal et. Anahtar iptal edilince hiçbir yol para harcayamaz.

## Tarayıcının gönderdiği istek

```
POST /v1/jobs
Origin: https://erenulutas0.github.io
Authorization: Bearer <davet kodu>
Content-Type: audio/webm           (site bunu yollar; Opus yoksa audio/mp4. Kabul edilenler: ogg, opus, webm, mp4, x-m4a, flac, wav, mpeg)
Content-Length: <bayt>
X-Audio-Duration-S: 1235           (sesin gerçek süresi; site tam saniyeye yukarı yuvarlar)
X-Job-Id: <UUID>                   (isteğe bağlı: tarayıcının iş için ürettiği rastgele ad)
X-Language: auto                   (ya da en, tr, ja …; site göndermez → otomatik)
X-Speaker-Labels: 1                (0 = istemiyorum)

<ses baytları — yalnızca ses, görüntü yok>
```

Yanıt `202 {"jobId":"…","status":"queued","reservedMinutes":20.58}`. Hata kodları: `cloud_off`
(503), `monthly_cap_reached` (503), `invite_required` / `invite_invalid` (401),
`invite_minutes_used_up` (402), `job_in_progress` (409), `job_id_taken` (409), `job_canceled` (409),
`bad_job_id` (400), `too_long` / `too_large` (413), `not_audio` (415), `rate_limited` (429,
`Retry-After` ile), `provider_error` (502; sağlayıcının metni asla geçirilmez).

**`X-Job-Id` (11 Ekim 2026).** Tarayıcı işi kendisi adlandırırsa, yarıda kestiği bir yüklemeyi ya da
yanıtı kaybolan bir başlatmayı `DELETE /v1/jobs/:id` ile geri verebilir; vermezse aynı davet
30 dakika (çalışan iş için 24 saate kadar) `job_in_progress` alırdı. Kurallar: UUID biçiminde
olmalı; var olan bir ad — kimin olursa olsun — `job_id_taken` ile reddedilir (başkasının işi
hakkında hiçbir şey öğrenilmez: sorgu yine davete bağlıdır, 404). Yükleme sürerken silinen iş için
sağlayıcıda kayıt açılmaz (`job_canceled`); son anda silinenin kaydı sağlayıcıda hemen silinir,
silinemezse temizlik alarmı siler. `DELETE`, sağlayıcının durumu okunamasa da siler.

`GET /v1/quota` (aynı başlıklarla, gövdesiz) → `{"on":true,"remainingMinutes":37,"maxJobMinutes":120}`:
sitenin seçim ekranındaki "X dakika düşer, Y dakikan kalır" satırı buradan gelir. Bilinen kodla
hız sınırına sayılmaz; **bilinmeyen (ya da iptal) kodla** sayılır ve sınırın üstünde `429 rate_limited`
döner (15 Ekim 2026: kod tahmini kota ucundan da başlatmadan ucuz değil — [`../SECURITY.md`](../SECURITY.md) M1).

**Site tarafı (11 Ekim 2026: yazıldı, kapalı).** Sitenin CSP'si `connect-src 'self'`dir ve bulut
istemcisi yayındaki derlemede yoktur. Site bu Worker'la ancak derlemeye
`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=https://<bu Worker'ın kökeni>` verilirse konuşur (CI'da depo
değişkeni `CLOUD_TRANSCRIPT_URL`); o zaman `connect-src` yalnızca bu kökeni kazanır. Sıra ve
ayrıntı: ADR-039 "Yayın için yapılacaklar". `ALLOWED_ORIGINS` sitenin kökenini içermelidir;
`PROVIDER_REGION` **`eu` kalmalıdır** — sitenin rıza ekranı "Avrupa'daki bilgisayarlar" der.

## Sözleşme ve yerel sahte Worker

Tarayıcıya bakan API, `cloud/contract/cases.mjs` içinde 18 durum olarak yazılıdır. Aynı liste iki
uygulamaya koşar:

- **gerçek Worker koduna**, workerd içinde, gerçek Durable Object ile (`worker/test/contract.test.ts`);
- **yerel sahte Worker'a** (`cloud/fake-worker/server.mjs`) — bağımlılığı olmayan, 127.0.0.1'de
  dinleyen, hiçbir yere bağlanmayan bir Node sunucusu; web uygulamasının sınamaları
  (`web/tests/cloud/`, `npm run quality`'nin bulut yürüyüşü) onunla konuşur.

Worker'ın bir cevabı değişirse sahte aynı durumda kırılır. Sahte sunucu konuşmayı duymaz; sınamanın
verdiği kelimeleri döndürür. Bir yanıtı burada değiştiren, önce `cases.mjs`'i değiştirir.

## Sınamalar

```bash
cd cloud
npm run test:worker     # 57 sınama (25 + 19 sözleşme + 13 güvenlik): gerçek Workers çalışma zamanı (workerd) + gerçek Durable Object, sahte sağlayıcı
npm run test:fake       # 30 sınama (aynı 19 sözleşme + 5 sahteye özgü + 6 kurucu komutu): yerel sahte Worker
npm run typecheck
```

Güvenlik ve kötüye kullanım incelemesi, kurucu komutu (`cloud/admin.mjs`), anahtar/belirteç döndürme ve olay
kılavuzu: [`../SECURITY.md`](../SECURITY.md) (15 Ekim 2026).

Sınamalarda ağ yoktur: Worker'ın ve Durable Object'in her dış isteği yerel sahte sağlayıcıya
düşer; başka bir adrese giden istek sınamayı düşürür.

## Doğrulanmayanlar

- Gerçek Cloudflare'de hiç çalıştırılmadı: 10 ms işlemci sınırı içinde kalıp kalmadığı,
  Durable Object alarmının Free planda çalışması, akıtılan gövdenin sağlayıcıya ulaşması.
- `npx wrangler deploy --dry-run` bu makinede koşulamadı (Node 20; wrangler Node 22 istiyor).
  Yapılandırma dosyasını sınama düzeneği okuyup kullandı.
- Sağlayıcının `audio_end_at` verilen işi neye göre faturaladığı ve `audio_duration` alanında
  hangi süreyi bildirdiği.
- `@cloudflare/vitest-pool-workers` paketi kullanımdan kaldırılıyor (yeni adı
  `@cloudflare/vitest-plugin`); 0.22.0 çalışıyor, ileride taşınmalı.
