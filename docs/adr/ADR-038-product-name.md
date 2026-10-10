# ADR-038 — Ürünün adı: LiloCut

> Tarih: 10 Ekim 2026 · Durum: UYGULANDI (web) · Politika ve şema değişmedi
> İlgili: `video-editor-blueprint/docs/30_RISKS_DECISIONS.md` (K01), [ADR-031](ADR-031-phone-share-install-offline.md)
> (yüklenen uygulama, hizmet çalışanı), [ADR-012](ADR-012-w3-local-persistence.md) (yerel kayıt).

## Kurucu kararı

Ürünün adı **LiloCut**'tır (tam olarak bu yazımla). "Clip", 10 Ekim 2026'ya kadar kullanılan geçici
çalışma adıydı (belge 30 K01). Daha eski tarihli ADR'ler, değişiklik kaydının eski girdileri ve ölçüm
raporları yazıldıkları gibi bırakıldı: oralarda "Clip" geçer ve o günkü adı anlatır.

Bu karar yalnızca addır. **Yapılmayan:** marka benzerliği, alan adı ve mağaza bulunabilirliği incelemesi.
Hiçbir yerde tescil ya da uygunluk iddiası yoktur; inceleme yayın öncesi açık iştir (K01'e not düşüldü).

## Ad tek yerde yazılır

`web/src/appIdentity.ts`:

- `APP_NAME = 'LiloCut'` — adın yazıldığı tek satır;
- `APP_SLUG` (`lilocut`) — dosya adlarındaki biçimi, addan türetilir;
- `pageTitle(sayfa)` — sekme başlıkları ("LiloCut — editör");
- `BACKUP_FILE_SUFFIX` (`.lilocut.json`), `BACKUP_DEFAULT_BASENAME` (`lilocut-projesi`).

Bunlardan türeyenler: manifest `name` / `short_name`, `applicationName`, iOS başlığı, bütün sayfa
başlıkları, logodaki yazı (`Wordmark`), `i18n/messages.ts` içindeki görünür metinler (TR ve EN: editör
başlığı, gizlilik sayfası başlığı, transkript dosyasının ilk satırı, yedek dosyasının anlatımı), tanı
dosyasının adı (`lilocut-tani-YYYYMMDD-HHMM.json`) ve proje yedeğinin adı (`<proje adı>.lilocut.json`).
Testler de adı buradan okur. Bir sonraki ad değişikliği bu tek satırdır.

Koruma: `web/tests/unit/appIdentity.test.ts`. Eski ad bir **ürün adı** olarak geri gelirse kalır
(mesajlarda, manifestte, kaynak dizgilerinde); adın `appIdentity.ts` dışında yeniden yazılmasını da
yakalar. Kesitin İngilizcesi olan "clip" ("Clip {n} added", "Clips"), kod adları ve aşağıdaki depolama
adları bu korumanın dışındadır. Aynı gün önerilip geri çekilen bir ad da depoda hiçbir yerde geçemez.

Ana sayfanın altındaki "Clip geçici çalışma adıdır." cümlesi kaldırıldı (`app.workingName`).

## Bilerek değiştirilmeyenler

| Ne | Ad | Neden |
|---|---|---|
| IndexedDB veritabanı | `clip-editor` | Kayıtlı proje ve dışa aktarma günlüğü burada; adı değişirse eski kullanıcının projesi görünmez olur |
| OPFS geçici dosyaları | `clip-export-…` | Yarım kalan dosyaların temizliği bu öneke bakar |
| Uygulamanın çevrimdışı önbelleği | `clip-app-<sürüm>` | Hizmet çalışanı eski önbellekleri bu önekle bulup siler; önek değişirse eskiler diskte kalır |
| Model önbelleği | `clip-models-v1` | Değişirse indirilmiş 109–596 MB'lık model yeniden indirilir |
| localStorage anahtarı | `clip.firstRunHint.dismissed` | Değişirse kapatılmış ipucu yeniden çıkar |
| Hizmet çalışanı iletileri, worker adları | `clip-sw:activate`, `clip-export`, `clip-hdr`, … | İç adlar; eski ve yeni sürüm aynı anda açıkken birbirini anlamalı |
| Tanı dosyasının biçim kimliği | `kind: "clip-diagnostics"` | Dosya biçiminin adı; okuyan araçlar buna bakar |
| Altyazı yazı tipinin CSS aile adı | `Clip Caption` | Kullanıcı görmez; tuvale çizim bu adla yapılır |
| Ortam değişkenleri | `CLIP_TEST_HOOKS`, `NEXT_PUBLIC_CLIP_TEST_HOOKS` | Derleme ve CI bunlara bağlı |
| Depo, adres | `capcut`, `/capcut` taban yolu | Kapsam dışı; adres değişirse yüklenmiş uygulamalar ve yer imleri kopar |
| npm paket adı | `clip-web` | `private`; yalnızca kilit dosyasında görünür |

Gizlilik sayfası ve veri envanteri bu depolama adlarını oldukları gibi (eski adla) göstermeye devam eder:
kullanıcı tarayıcının geliştirici araçlarında tam olarak bunları görür.

Eski yedek dosyaları (`….clip.json`) aynı biçimde açılır: içe aktarma dosyanın adına değil içeriğine bakar
(testlerde `eski.clip.json` adıyla içe aktarılan yedekler bunu sınar).

## Yüklenmiş uygulama (PWA) ve önbellek

- **Önbellek sürümünü elle artırmak gerekmez.** Önbelleğin adı `clip-app-<16 hex>`; bu 16 karakter,
  saklanan her dosyanın (sayfalar, manifest, derleme dosyaları) baytlarından ve hizmet çalışanının kendi
  kodundan hesaplanır (`scripts/lib/precache.mjs`, `precacheVersion`). Ad sayfaların ve manifestin içinde
  geçtiği için yeni derleme yeni bir önbellek adı üretir; açık sekmeler ADR-031'deki güncelleme
  akışıyla ("Yeni sürüm hazır") yeni kabuğu alır, eski önbellek silinir.
- **Manifest değişti** (`name`, `short_name`); `id`, `start_url`, `scope` aynı kaldı, yani tarayıcı için
  bu **aynı uygulamadır**, yeni bir uygulama değil.
- **Yüklenmiş uygulamanın simge altındaki adı — bu makinede/telefonda DOĞRULANMADI.** Tarayıcıların
  belgelerine göre beklenen: Android'de Chrome yüklenmiş uygulamanın manifestini aralıklarla yeniden
  okur ve adı kendiliğinden günceller (hemen değil, günler sürebilir); masaüstü Chrome/Edge ad değişikliğini
  uygulama açıldığında fark eder ve kullanıcıya sorabilir; iOS Safari'de ad "Ana Ekrana Ekle" anında
  sabitlenir, değişmesi için simgenin silinip yeniden eklenmesi gerekir. Kurucunun telefonunda
  (S23) yüklü uygulama için gerçek davranış ayrıca gözlenmeli.

## Testler

Birim: `appIdentity.test.ts` (8 test). e2e: manifest adı (`pwa.spec.ts`, `tests/pages/pages-smoke.spec.ts`),
transkript dosyasının ilk satırı (`transcript.spec.ts`), tanı dosyasının adı (`privacy.spec.ts`) adı
`appIdentity.ts`'ten okuyarak doğrular. Sayılar değişiklik kaydında.
