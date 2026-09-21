# ADR-012 — W3: yerel kayıt ve dosyayı yeniden bağlama

> Tarih: 2026-09-21 · Durum: UYGULANDI ve TEST EDİLDİ
> Kapsam: tek cihazda, tek tarayıcıda yerel kalıcılık. Bulut, hesap ve senkron
> hâlâ kapsam dışı.

## Bağlam

W2'ye kadar proje yalnızca sekmede yaşıyordu: sayfa yenilenince bütün düzenleme
tarifi kayboluyordu. PRD R08 ve roadmap P1-06 otomatik kayıt ve dosya yeniden
bağlama istiyor; doc 22'deki M14 fixture'ı bu yüzden çalıştırılamıyordu.

## Karar 1 — Sadece tarif saklanır, medya asla

IndexedDB'de tutulan `ProjectRecord` yalnızca EDL, başlık ve `AssetBinding`
listesinden oluşur. Video/ses byte'ları, blob URL'leri ve base64 veri hiçbir
zaman yazılmaz (doc 11). Tipik bir kayıt birkaç KB'dır; birim testi 8 KB
üstünü ve `blob:`/`data:` içeriğini reddediyor.

Bunun doğrudan sonucu: **tarif geri gelir, dosya gelmez.** Tarayıcı bir `File`
nesnesini oturumlar arası saklayamaz. Ürün bunu gizlemek yerine açıkça
söylüyor ve kullanıcıdan aynı dosyayı seçmesini istiyor.

## Karar 2 — Dosya kimliği ada değil, ölçülebilir alanlara dayanır

`AssetBinding` boyut, değiştirilme zamanı, probe edilen süre ve görüntü
boyutlarını tutar; parmak izi bunlardan üretilir. **Dosya adı parmak izine
girmez**, çünkü insanlar dosyaları yeniden adlandırır.

Yeniden seçilen dosya üç şekilde değerlendirilir:

| Sonuç | Koşul | Davranış |
|---|---|---|
| `exact` | bütün alanlar aynı | sessizce bağlanır |
| `likely` | boyut, süre ve kare boyutu aynı, değiştirilme zamanı farklı | bağlanır (kopyalanmış/yeniden indirilmiş aynı dosya) |
| `mismatch` | diğer her şey | **bağlanmaz**, kullanıcıya sorulur |

Mismatch'te anlar korunur ve kullanıcı açık bir uyarı görür: bu dosya farklı,
mevcut anlar başka görüntülere denk gelebilir. Ancak açıkça "yeni kaynak olarak
kullan" derse anlar silinir (doc 11: "farklı dosya yeni kaynak olarak eklenir").

Süre karşılaştırmasında 50 ms tolerans var: aynı dosyanın iki probe'u bir kare
oynayabilir.

## Karar 3 — "Kaydedildi" yalnızca commit olduysa yazar

Kayıt döngüsü doc 10'un tarifi: domain değişikliği → revision artışı → 500 ms
debounce → transactional yazma. Durumlar: `idle`, `saving`, `saved`, `failed`.

- `saved` yalnızca IndexedDB transaction'ı tamamlandıktan sonra gösterilir.
- Başarısız yazma sessizce yutulmaz; "Kaydedilemedi" + sebep gösterilir ve
  yedek dosyası indirme yolu sunulur (doc 10'un istediği kurtarma yolu).
- Tooltip açıkça şunu söyler: bu bir bulut yedeği değildir, tarayıcı verisi
  temizlenirse veya başka cihaz/tarayıcı kullanılırsa proje orada olmaz,
  video dosyaları hiçbir zaman kaydedilmez.

Sekme gizlenirken/kapanırken best-effort flush yapılır; mutlak sıfır kayıp
garantisi verilmiyor ve verilmediği yazılı.

## Karar 4 — Çıkış uyarısı sadece gerçekten riskli işte

W2'ye kadar her düzenlemeden sonra `beforeunload` uyarısı çıkıyordu. Otomatik
kayıt geldikten sonra bu yanlış: iş zaten kaydedilmiş oluyor. Uyarı artık
yalnızca yazma sürerken (`saving`) veya yazma reddedilmişken (`failed`)
gösteriliyor. Kurt masalı anlatan bir uyarı, uyarı olmamasından kötüdür.

## Karar 5 — Depodan okunan veri de girdidir

`parseRecord` her kaydı doğrular: sürüm, EDL geçerliliği ve binding alanları.
Kendi veritabanımızdan geldi diye güvenilmez — eski bir sürüm, elle düzenlenmiş
bir yedek veya bozulmuş bir satır olabilir. Geçersiz kayıt yüklenmez,
`corrupt` olarak raporlanır.

Aynı doğrulayıcı yedek dosyası içe aktarımında da kullanılıyor.

## Karar 6 — Yedek dosyası hem çıkış hem giriş

Doc 10 yalnızca "EDL'yi dışa alma" kurtarma yolunu istiyor. Yalnızca dışa alım
kullanıcı için çıkmaz sokak olacağı için içe alım da eklendi (`.clip.json`).
Dosya videoyu içermez; yalnızca tarifi taşır ve karşı tarafın aynı medyaya
sahip olması gerekir (doc 10).

## Ölçülen sonuç

Yeni birim testleri: parmak izi kararlılığı, ad değişikliğine duyarsızlık,
exact/likely/mismatch sınırları, kayıt round-trip'i, bozuk/ileri sürüm reddi,
eksik binding listesi. Toplam birim testi 94 → **108**.

Yeni tarayıcı testleri (`tests/e2e/persistence.spec.ts`, 10 test, hepsi geçti):

- yenilemeden sonra tarif geri geliyor ve **doğru dosya adı** isteniyor;
- aynı dosya seçilince anlar korunuyor ve **gerçek export çalışıyor**;
- farklı dosya reddediliyor, anlar değişmeden duruyor;
- "yeni kaynak olarak kullan" denince anlar siliniyor ve süre yeni dosyanınki oluyor;
- müzik ayrı olarak yeniden bağlanıyor ve düzenlenmiş segment korunuyor;
- kaynak yokken export doğru gerekçeyle kapalı;
- kayıtlı proje silinebiliyor ve uygulama kullanılabilir kalıyor;
- **IndexedDB reddedilen bir tarayıcıda** (fault injection ile gizli sekme
  taklidi) editör çalışmaya devam ediyor, "Kaydedilemedi" gösteriyor ve
  **asla "Kaydedildi" demiyor**;
- yedek dosyası tarifi taşıyor, medya taşımıyor (20 KB altı, `blob:`/`data:` yok).

Toplam tarayıcı testi 24 → **34**.

**M14 artık çalıştırılabilir ve geçiyor.** Sayfayı yeniden yüklemek gerçek
koşulu birebir üretiyor: tarif duruyor, `File` nesnesi yok. Matris koşusu
yeniden bağlayıp 10 saniyelik, 300 karelik doğru çıktıyı üretiyor. Böylece
doc 22 matrisindeki **bütün satırlar** Chromium/Chrome/Edge'de çalıştırılabilir
hale geldi.

## Bilinen sınırlar

- Tek proje saklanıyor (`projectId` sabit). Proje listesi/çoklu proje yok.
- File System Access API ile kalıcı dosya izni kullanılmadı: Chromium'a özgü ve
  kullanıcı jesti gerektiriyor. Şimdilik her oturumda dosya yeniden seçiliyor.
- OPFS'e geçici medya yazılmıyor; doc 11 bunu "mevcutsa ve test edilmişse"
  diye koşula bağlıyor ve test edilmedi.
- Gizli sekme davranışı gerçek bir gizli pencerede değil, fault injection ile
  test edildi.
- Depolama kotası dolduğunda gerçek davranış test edilmedi; kod yolu var
  (`quota_exceeded`) ama tetiklenmedi.

## Sonraki tek görev

**W4 — gerçek kullanıcı medyası:** matrisi gerçek telefon/kamera kayıtlarıyla
tekrarlamak (gerçek VFR, rotation, HEVC, 4K, uzun kayıt), oradan çıkacak bellek
ve süre ölçümleriyle `StreamTarget` kararını vermek.
