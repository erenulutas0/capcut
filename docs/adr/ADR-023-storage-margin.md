# ADR-023 — OPFS çıktı yolu için depolama payı: yer baştan ayrılır

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek Windows makinesi; Chromium ve Chrome; Edge'de yalnızca matris ve gerçek kayıtlar).
> Teknik bir güvenlik parametresi; fiyat veya kota değildir, doc 15 değişmez.

## Bağlam

ADR-013'ten beri OPFS yolu, `navigator.storage.estimate()` boş alanının tahmini
dosyanın **iki katı** olmasını istiyordu; tahmin "bit hızları + %25"ti. 60 dakika
1080p için bu ~6,0 GiB demekti, gerçek dosya ise 2,4 GiB'tı (ADR-020). Soru:
gerçekte ne kadar yer gerekiyor, kontrol doğru şeyi ölçüyor mu, disk dışa
aktarma ortasında dolarsa ne oluyor?

## Bulgular

### 1. `estimate()` diski görmüyor (ölçüldü)

Chromium 153 ve Chrome 153'te, kalıcı profilde, `estimate()` her durumda
**kota = kullanım + 10 GiB** döndürdü:

| Profilin sürücüsü | Gerçek boş alan | `quota − usage` |
|---|---|---|
| C: (464,7 GiB disk) | 12,2 GiB | 10,00 GiB |
| E: (1863 GiB disk) | 796,9 GiB | 10,00 GiB |
| C:, 1 GiB OPFS dosyası varken | 11,2 GiB | 10,00 GiB (kota 11,00, kullanım 1,00) |

Bu, Chrome'un bilinçli davranışı: gizli pencere tespitini ve parmak izini
önlemek için sınırlı depolama izni olan sitelere "kullanım + 10 GiB" gibi
yapay bir kota bildiriliyor
([blink-dev PSA](https://groups.google.com/a/chromium.org/g/blink-dev/c/7q0YGQNVkjs/m/mpYkQVWpAQAJ),
[StaticStorageQuotaEnabled politikası](https://chromeenterprise.google/policies/static-storage-quota-enabled/)).
Sonuç: eski kontrol (`boş ≥ 2 × tahmin`) pratikte **sabitti**. 10 GiB'ın
altındaki her ihtiyaç geçiyordu, gerçek disk ne kadar dolu olursa olsun. Az
yeri olan kullanıcı baştan reddedilmiyordu. Kodlamaya başlıyor, dakikalar sonra
disk dolunca hata alıyordu. Kurucunun "az yeri olan reddediliyor" endişesi bu
tarayıcılarda gerçekleşmiyordu. Ters yönde, daha kötü bir sorun vardı.

Gerçek sınırın tarayıcı tarafından uygulandığı ölçüldü: C:'de 20 GiB'lık yer
ayırma `QuotaExceededError` ile reddedildi, E:'de kabul edildi (E:'de gerçek
kota 10 GiB'tan büyük). CDP `Storage.overrideQuotaForOrigin` ile 20 MiB kota
verilince `estimate()` yine 10 GiB gösterdi. Ama 64 MiB yazma, 16 MiB'tan
sonra `QuotaExceededError: No space available for this operation` ile durdu.
Aynı hata `truncate()` ile yer ayırmada da geldi. ADR-020'nin "CDP kota
geçersiz kılma tahmine yansımadı" notu doğru, fakat kota **uygulanıyor**.

### 2. mediabunny dosyayı bir kez yazar (koddan ve ölçümden)

`fastStart: false` ile `mdat` sırayla akıyor, boyutu yerinde yamanıyor
(`largeSize` baştan ayrılmış), `moov` sona ekleniyor
(`isobmff-muxer.js` finalize). İkinci kopya, geçici dosya veya sonda yeniden
yazma yok. Ölçüm: profil klasörünün diskteki boyutu kodlama boyunca ~0,5 s
aralıkla örneklendi. OPFS tepesi, aşağıdaki yer ayırmanın kendisi. Kesilince
dosya boyutuna iniyor.

### 3. "Bilgisayara kaydet" dosyayı diskten diske akıtır

İndirme, OPFS'teki `File`'dan (blob URL) indirme klasörüne akıyor. Profil
büyümedi. Tarayıcı süreçlerinin belleği indirme boyunca taban çizgisini aşmadı.
İndirme klasörünün sürücüsünde boş alan dosya boyutu kadar düştü.

| İndirme | Süre | Hedef sürücüde düşüş | Profil büyümesi | Bellek (taban → tepe) |
|---|---|---|---|---|
| 1803 MiB (Chromium) | 4,5 s | 1804,8 MiB | 0 | 319 → 315 MiB |
| 684 MiB (Chromium) | 2,0 s | 683,9 MiB | 0 | 300 → 294 MiB |
| 610 MiB (Chrome) | 1,4 s | 610,3 MiB | 0 | 626 → 610 MiB |

Yani indirme anında aynı sürücüde **dosya iki kez** durur (OPFS'teki geçici
kopya + indirilen). Sayfa indirme klasörünü göremez; bu ikinci kopya
kontrol edilemez. Kaydetme başarısız olursa dosya pencere kapanana dek sunulmaya
devam eder.

### 4. Boyut tahmini: uzun çıktıda gerçek/nominal 0,98–1,00

Nominal = (video + ses bit hızı) × süre / 8. Ölçümler kalıcı profille,
`scripts/measure-export-storage.mjs` ile yapıldı. Bütün çıktılar ffprobe ile
doğrulandı; süreler birebir.

| Çıktı (1080p) | Tarayıcı | Kodlayıcı hedefi | Dosya | Nominal | Gerçek/nominal | Eski gereksinim (2 × 1,25) | Yeni gereksinim (1,1 + 32 MiB) |
|---|---|---|---|---|---|---|---|
| 15 dk sentetik yoğun | Chrome | 5,60 Mbit/s | 610,2 MiB | 614,4 MiB | 0,993 | 1536 MiB | 708 MiB |
| 15 dk sentetik yoğun | Chromium | 16,80 Mbit/s (ADR-024) | 1803,3 MiB | 1815,8 MiB | 0,993 | 4540 MiB | 2029 MiB |
| 5 dk 41 s gerçek (iPhone 11) | Chrome | 5,60 | 229,0 MiB | 232,9 MiB | 0,983 | 582 MiB | 288 MiB |
| 5 dk 41 s gerçek | Chromium | 16,80 | 683,9 MiB | 688,4 MiB | 0,993 | 1721 MiB | 789 MiB |
| 88,7 s gerçek 60 fps (iPhone 13 Pro) | Chrome | 5,60 | 60,5 MiB | 60,5 MiB | 1,000 | 151 MiB | 99 MiB |
| 88,7 s gerçek 60 fps | Chromium | 16,80 | 178,0 MiB | 178,9 MiB | 0,995 | 447 MiB | 229 MiB |
| 60 dk sentetik (ADR-020) | Chromium | 5,60 | 2447,1 MiB | 2457,6 MiB | 0,996 | 6144 MiB | 2735 MiB |
| 60 dk sentetik (ADR-020) | Chrome | 5,60 | 2430,7 MiB | 2457,6 MiB | 0,989 | 6144 MiB | 2735 MiB |

Kısa gerçek kliplerde oran daha yüksek: Chrome'un donanım kodlayıcısı 8 sn'lik
kliplerde 1,06–1,33, 1,8 sn'lik R15'te 1,50 kat. Mutlak fazlalık 1 MiB'ın
altında (en büyüğü R04: +0,83 MiB). Sentetik matris nominalin altında kalıyor
(0,07–0,94).

Eski "+%25 konteyner payı" gerçekte konteyner payı değildi. `moov` 60 dakikada
birkaç MiB. Kodlayıcı taşmasına karşı bir tampondu ve uzun çıktıda gerekmiyordu.

## Karar

1. **Tahmin** (`src/domain/outputStorage.ts`, saf ve birim testli):
   `nominal × 1,1 + 32 MiB`. 1,1: uzun çıktıda ölçülen en büyük oran 1,00;
   ölçülmemiş içerik için %10 pay. 32 MiB: kısa klip taşması (< 1 MiB) ve `moov`.
   Gerekli boş alan = tahmin (iki katı değil). Dosya bir kez yazılıyor.
2. **Gerçek kontrol: yer baştan ayrılır** (`outputSink.ts`). OPFS dosyası
   açılır açılmaz `truncate(gereken)` ile tahmin boyutuna getirilir. Tarayıcı
   bunu gerçek kotasına sayıyor ve işletim sistemi yeri ayırıyor. C:'de 1 GiB
   ayırma 2–3 ms sürdü, sürücünün boş alanı tam 1024 MiB düştü, kesince geri
   geldi. Yer yoksa `QuotaExceededError` geliyor. Çıktı > 5 dk ise ilk kare
   kodlanmadan `output_storage_insufficient`. ≤ 5 dk ise eskisi gibi bellek
   yolu. Kodlama bitince muxer dosyayı kapatırken dosya gerçek uzunluğuna
   kesilir.
   - Tahmin aşılırsa dosya büyümeye devam eder. Yalnızca disk gerçekten doluysa
     durur. O zaman da dürüst hata verir.
   - Gizli pencere / bellek içi OPFS (Playwright'ın varsayılan bağlamı):
     8 GiB `truncate` hata vermeden **boyutu 0 bıraktı**. Bu yüzden ayırmadan
     sonra `getSize()` kontrol ediliyor. Tutmadıysa ret. 1 GiB ayırma orada
     363 ms sürdü ve RAM'den ayrılıyor. ADR-013'e göre o modda dosya zaten RAM'de
     büyürdü. Tepe aynı, yalnızca başa alınıyor.
3. **İlk kontrol olarak `estimate()` kaldı.** Chromium'da sabit (≥ 10 GiB)
   olduğu için yalnızca 10 GiB'ı aşan bir ihtiyacı yakalar. Test kancası
   `window.__clipStorageFreeBytes` bu kontrolü sürmeye devam ediyor.
4. **Ret mesajı iki sayıyı söyler** (TR + EN, ikili birimler: gereksinim
   yukarı, bildirilen alan aşağı yuvarlanır):
   - tahmin yetmediyse: "Bu video için gereken boş alan: X. Tarayıcının
     bildirdiği boş alan: Y."
   - ayırma başarısızsa: "… Tarayıcı bu kadar yeri diskte ayıramadı, yani
     diskte o kadar boş yer yok. Tarayıcının tahmini Y gösteriyordu; bu tahmin
     diskin gerçek doluluğunu göstermez."
5. **Kodlama ortasında dolan disk:** `output_storage_full` mesajı artık yarım
   dosyanın silindiğini ve indirilecek bir şey olmadığını söylüyor.

Sayılar (60 dk 1080p, donanım kodlayıcı): önce ~6,0 GiB isteniyordu ama
ölçülmüyordu. Şimdi 2,67 GiB isteniyor ve gerçekten ayrılıyor.

## Testler

- `tests/unit/outputStorage.test.ts`: tahmin formülü, ölçülen 9 dosyanın hepsi
  tahminin altında, 60 dk 1080p < 2,8 GiB ve eski kuralın < %47'si, sınır
  (tam gereksinim geçer, 1 bayt eksik reddedilir; NaN/∞ asla geçmez), biçim.
- `tests/unit/outputSink.test.ts`: kotayı uygulayan sahte OPFS ile ayırma ve
  kesme, ayırma reddi (dosya kalmaz), sessizce tutmayan `truncate`, tahmin reddi
  (iki sayı), test kancası, ayrılan yerden taşıp dolan disk
  (`QuotaExceededError`), zorlanmış bellek yolu.
- `tests/e2e/output-limits.spec.ts`, gerçek tarayıcı kotasıyla (CDP):
  - 64 MiB kota, 5:10 çıktı: ilk kare kodlanmadan ret, "ayıramadı" satırı ve
    gerekli MiB, indirme düğmesi yok, OPFS'te dosya yok.
  - 3 MiB kota + `window.__clipStorageReserveBytes = 1 MiB` (yeni test kancası:
    yalnızca baştan ayrılan miktarı küçültür): kodlama başlıyor, dosya kotayı
    aşınca **tarayıcının kendi** yazma hatası geliyor. Sonuç
    `output_storage_full`: başarı yok, indirme yok, geçici dosya silinmiş.
  - Mevcut 40 MB tahmin testi artık sayı satırını da doğruluyor.

## Ölçülmeyenler

- **Gerçekten dolu bir disk.** Disk doldurulmadı (C:'nin 12 GiB boş alanı
  başka ajanlarla paylaşılıyor). Dolu disk tarayıcının kota uygulamasıyla ve
  20 GiB'lık gerçek ayırma reddiyle sınandı.
- Chromium'un bıraktığı güvenlik payı (`must_remain_available`) ölçülmedi; ayırma
  bunu zaten tarayıcıya bırakıyor.
- macOS/Linux dosya sistemleri (ext4/APFS'te `truncate` seyrek dosya
  üretebilir. Ayırma o zaman kotaya sayılır ama diskte yer ayırmayabilir).
  Safari ve Firefox'ta OPFS ayırması.
- Edge'de depolama ölçümü (Edge aynı Chromium; matris ve gerçek kayıtlar
  geçti).
- 4 GiB'ı aşan çıktı (yazılım kodlayıcıyla 60 dk 1080p ~7,1 GiB olur; ADR-024).
- Tablodaki koşularda ayırma 1,25 kat (ilk sürüm) ile yapıldı: tepe = ayrılan
  (ör. 804 MiB, sonra 614 MiB'a kesildi). Katsayı sonra 1,1'e indirildi ve
  yalnızca bir koşu tekrarlandı: R10, Chrome, C: sürücüsü. Tepe 288,6 MiB
  (gereksinim 288,2 MiB). Kodlama boyunca C:'nin boş alanı 291 MiB düştü,
  `estimate()` 10240 MiB'ta sabit kaldı. Dosya bayt bayt aynı (240 140 990).
  Diğer koşular 1,1 ile tekrarlanmadı.

Kanıt dosyaları git dışında: `web/matrix-results/export-storage-*.json`.

## Bağlantılar

ADR-013 (OPFS yolu), ADR-020 (60 dk çıktı; "payın küçültülmesi ayrı karar"
notu burada kapandı), ADR-024 (yazılım kodlayıcı bit hızı; tahmin kodlayıcının
gerçek hedefini kullanır).
