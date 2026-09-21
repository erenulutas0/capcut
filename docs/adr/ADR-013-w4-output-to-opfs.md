# ADR-013 — W4: çıktıyı OPFS'e akıtmak ve gerçek kayıt koşucusu

> Tarih: 2026-09-21 · Durum: UYGULANDI ve ÖLÇÜLDÜ (bellek kısmı);
> gerçek kayıt kısmı **kullanıcı kayıtlarını bekliyor**.

## Bağlam

ADR-011, `BufferTarget` → `StreamTarget` kararını ölçüm olmadan vermeyi reddetti:
`performance.memory` Chromium'da gizlilik için yuvarlanıyor ve encode worker'ını
hiç görmüyor; sentetik test deseni de encoder'ı hedef bitrate'in çok altında
bıraktığı için dosya boyutları gerçekçi değildi (180 sn = 4.4 MB).

W4'ün sorusu: **gerçekçi bir çıktıda export ne kadar bellek tutuyor, ve bu
çıktının bellekte durmasından mı kaynaklanıyor?**

## Karar 1 — Bellek işletim sisteminden ölçülür

`scripts/lib/process-memory.ps1` tarayıcı süreç ağacının (ana süreç, renderer,
GPU, yardımcılar) private bytes değerini ~400 ms aralıkla örnekler. Encode
worker renderer sürecinde çalıştığı için bu değer onu da kapsar.
`scripts/measure-export-memory.mjs` gerçek editörü sürer, export ederken
örnekler ve sonucu ffprobe ile doğrular. Şimdilik yalnızca Windows.

Gerçekçi bitrate için `L01` fixture'ı eklendi: hareketli desen + zamansal
gürültü. Encoder artık bütçesini harcıyor (hedef ~5.6, ölçülen **5.44 Mbit/s**).

## Karar 2 — Ölçüm kalıcı profille yapılır

İlk ölçüm yanıltıcı çıktı ve bu kayda değer: Playwright'ın varsayılan
`newContext()` bağlamı kalıcı değil, ve Chromium bu durumda OPFS'i **diske değil
RAM'e** yazıyor. O koşuda bellek renderer'dan tarayıcı sürecine taşındı, toplam
düşmedi, her koşuda taban yükseldi (201 → 592 MiB).

Gerçek kullanıcının normal profili disk destekli olduğu için ölçüm
`launchPersistentContext` ile tekrarlandı. Aynı nedenle **gizli pencerede OPFS
yolu bellek kazancı sağlamaz** — bu belgelenmiş bir sınırdır.

## Karar 3 — Adil A/B: eski kod ayrı worktree'de, aynı script

Eski bellek yolunun sayısını yeni profille yeniden almak için W3 commit'i
(`db62231`) ayrı bir git worktree'de derlenip başka portta çalıştırıldı; aynı
script, aynı profil tipi, aynı fixture ile ölçüldü.

| Çıktı (1080p) | Dosya | Bellek yolu: tepe (artış) | OPFS yolu: tepe (artış) |
|---|---|---|---|
| 30 s | 19.9 MiB | 588 MiB (+355) | 574 MiB (+350) |
| 60 s | 39.9 MiB | 605 MiB (+371) | 586 MiB (+346) |
| 120 s | 79.7 MiB | 654 MiB (+428) | 590 MiB (+355) |
| 180 s | 119.5 MiB | 778 MiB (+541) | 601 MiB (+363) |
| 300 s | 199.2 MiB | **1033 MiB (+787)** | **607 MiB (+362)** |

- Bellek yolunda ~350 MiB sabit maliyet + çıktı boyutunun **~2.2 katı** doğrusal
  artış var: çıktı hem muxer'da hem sayfadaki Blob'da tutuluyor.
- OPFS yolunda artış uzunluktan bağımsız, **~350 MiB'da sabit**.
- 5 dakikalık politika sınırında tepe **%41**, artış **%54** düştü.
- Hız aynı (300 sn: 66.8 s vs 68.9 s).
- Bellek yolunun 300 sn değeri iki koşuda 1033 ve 1192 MiB çıktı; koşudan koşuya
  ~%15 oynama var. OPFS yolunun beş noktası 574–607 MiB arasında tutarlı.

## Karar 4 — OPFS yolu, gerekirse bellek yoluna dürüst geri dönüş

`src/adapters/export/outputSink.ts`:

- Worker'da `navigator.storage.getDirectory()` + `createSyncAccessHandle()`
  varsa ve depolama tahmini çıktının iki katına yetiyorsa, muxer bir
  `StreamTarget` üzerinden doğrudan OPFS dosyasına yazar (`fastStart: false`,
  moov sonda). Yazımlar konumlu, çünkü muxer kutu boyutlarını geri dönüp düzeltiyor.
- Kısa yazım (disk/kota bitti) `output_storage_full` hatası olur; yarım dosya
  başarı sayılmaz ve silinir.
- Aksi halde kanıtlanmış bellek yolu kullanılır. Hangi yolun çalıştığı sonuçta
  `route` olarak taşınır ve başarı panelinde **"Yazıldığı yer"** satırında
  kullanıcıya gösterilir. Bu bir kalite düşüşü değil, bir bellek/disk
  takasıdır; o yüzden geri dönüş kabul edilebilir ama gizlenmez.
- Doğrulama adımı OPFS dosyasını `BlobSource` ile yerinde okur; kontrol için
  belleğe kopyalanmaz. Sayfa disk destekli `File`'ı alır ve indirme bağlantısını
  ondan kurar — ikinci kopya yok.

## Karar 5 — Geçici dosyalar birikmez

- Dialog kapatıldığında / yeni export başladığında sayfa kendi dosyasını siler.
- İptal ve hata yollarında worker yarım dosyayı siler.
- Editör her açıldığında 6 saatten eski `clip-export-*` dosyaları süpürülür
  (sekmesi kapanmış bir export'un artığı). 6 saat, başka bir açık sekmenin hâlâ
  indirme sunduğu dosyayı silmemek için seçildi.
- Silme yardımcıları ayrı bir modülde (`opfsEntries.ts`), böylece sayfa yalnızca
  dosya silmek için encoder kütüphanesini paketine çekmez.

İki yeni tarayıcı testi bunu doğruluyor: başarılı export'ta dosya OPFS'te
duruyor ve dialog kapanınca kayboluyor; iptal edilen export hiç dosya bırakmıyor.
Bellek ölçümünde her koşudan sonra kalan geçici dosya sayısı **0**.

## Karar 6 — Gerçek kayıt koşucusu, anonim sonuçlarla

`scripts/run-real-media.mjs` bir klasördeki kayıtları (`web/tests/media/real/`
varsayılan, git dışında) alır, dosya başına iki an üretir, 9:16 / 720p export
eder ve doc 22 matrisiyle **aynı sürücü ve aynı kontrollerle** doğrular (sürücü
`scripts/lib/matrix-driver.mjs` içine taşındı). Gerçek içerikte bilinen ton
olmadığı için ses, kaynağın aynı aralıklarındaki seviyesiyle karşılaştırılır
(±3 dB, güvenlik kazancı dahil).

Gizlilik: sonuç dosyasına **dosya adı yazılmaz**; yalnızca `R01` gibi anonim bir
kimlik ve teknik özellikler (codec, boyut, rotasyon, fps, VFR ipucu, renk
aktarımı, ses) yazılır. Ad eşlemesi yalnızca konsola basılır.

Koşucunun mekaniği sentetik dosyaların bir kopyasıyla ayrı bir klasörde denendi
(rotasyon, VFR ipucu, sessiz kaynak, HEVC reddi, SSIM 0.90–0.94, ses −1.0 dB).
Bu bir **koşucu testidir, gerçek kayıt sonucu değildir**; sonuç dosyası
yayımlanmadan silindi.

## Açık kalan: gerçek kayıtlar

**NOT_RUN — kullanıcı kayıtları gerekiyor.** Gerçek telefon/kamera kayıtları bu
ortamda yok; uydurulmadı, internetten telifli içerik indirilmedi. Destek matrisi
bunu açıkça "NOT_RUN" olarak gösteriyor.

Beklenen bir bulgu şimdiden söylenebilir: 250 MiB giriş sınırı nedeniyle birkaç
dakikalık 4K telefon kayıtlarının çoğu içe aktarmada reddedilecek (politika,
doc 15). Bu bir hata değil, politika; ancak gerçek kayıtlar geldiğinde sınırın
ürün için doğru olup olmadığı tartışılmalı.

## Bilinen sınırlar

- Bellek ölçümü yalnızca Windows + Chromium'da yapıldı.
- Gizli pencerede OPFS RAM'de tutulur; kazanç yoktur.
- Sekme kapandıktan sonra indirilmemiş bir çıktı en fazla 6 saat (bir sonraki
  editör açılışına kadar) tarayıcı depolamasında kalabilir.
- Depolama kotasının export ortasında dolması kod yolu var ama tetiklenmedi.

## Sonraki tek görev

**W5 — gerçek kayıtlarla doğrulama:** kullanıcı kayıtlarını
`node scripts/run-real-media.mjs` ile Chromium/Chrome/Edge'de çalıştırmak, çıkan
hataları düzeltmek ve 250 MiB / 20 dk giriş sınırının gerçek telefon kayıtları
için ürün kararını vermek.
