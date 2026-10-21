# ADR-050 — Editörde "Sesi düzelt": bütün karışık ses, indirmede ölçülür, −16 LUFS

> Tarih: 2026-10-21 · Durum: UYGULANDI (web; birim ve e2e, sayılar en altta). Telefonda, Safari'de ve
> Firefox'ta denenmedi. **Şema değişti: EDL v6** (`soundFix`, isteğe bağlı; v5'ten geçiş yalnızca numara).
> Politika **değişmedi** (doc 15 `2026-10-18.v12`: "Sesi düzelt" zaten ücretsiz, cihazda; bu iş aynı özelliği
> editöre getirir, hiçbir sınırı ya da hakkı değiştirmez).
> Kaynak: kurucu görevi ("Sesi düzelt'i editöre getir"; tasarım kararları bu ADR'ye devredildi).
> İlgili: [ADR-049](ADR-049-sound-fix.md) (zincir, ölçer, hedef, kart), [ADR-037](ADR-037-enhance.md)
> (editörde "Görüntüyü iyileştir": aynı biçimde bir tarif ayarı), [ADR-043](ADR-043-speakers-in-recipe.md)
> (EDL v5 ve "daha yeni kayıt" koruması), [ADR-027] (hızlı kesim), [ADR-042](ADR-042-export-failure-detail.md)
> (bekçi), `video-editor-blueprint/docs/10_PROJECT_SCHEMA_CONTRACTS.md` ("EDL v6").

## Bağlam

ADR-049'un kartı videonun sesini ölçer ve düzeltir; ama editörde sesi eşitlemenin hiçbir yolu yoktu. Editörde
kesilmiş, müzik eklenmiş bir videoda kısık konuşma kısık kalıyordu. ADR-049 "Kurucu kararları 2" bunu
ayrı iş olarak bırakmıştı (tarif şeması v6).

## Karar 1 — Tek ayar, Ayarlar → Ses'in en üstünde, proje başına açık/kapalı

- Bir onay kutusu: **"Sesi düzelt"**, altında bir satır: "İndirirken bütün ses (videonun sesi ve müzik
  birlikte) duyulur ve eşit olur: −16 LUFS. Burada oynatırken ses değişmez." Açılınca kartın kendi cümlesi
  eklenir: "Gürültüyü silmez: rüzgâr ve uğultu da sesle birlikte açılır. Kendi videon değişmez."
- **Neden Ses sekmesinin başı:** ayar bir kesitin ya da müziğin değil, bütün karışımın; "Videonun sesi"
  ve "Müzik" bölümlerinin üstünde, ikisini birden kapsadığı yerde durur. Ayarlar zaten "her indirmeye
  uygulanır" der (başlık). Görüntü sekmesindeki "Görüntüyü iyileştir"in eşi.
- **Neden onay kutusu, seçim listesi değil:** tek hedef var (−16). Seçilecek bir güç yok; açık ya da kapalı.
- **Varsayılan kapalı.** Eski projeler ve yeni projeler, kullanıcı açmadıkça önceki gibi ses verir.
- **Oynatıcı değişmez:** önizleme tarayıcının kendi `<video>`/`<audio>`'sudur; ayar bunu söyler. Editörde
  "Dinle (5 sn): Önce / Sonra" yok (aşağıda "Yapılmayanlar").
- Geri al: ayarı açmak ya da kapamak bir geri alma adımıdır (`changeSoundFix`).

## Karar 2 — Tarifte: `soundFix: { targetLufs: -16 }` (EDL v6)

- İsteğe bağlı ana alan; yoksa kapalı. Kapatmak alanı kaldırır: tarif ayarın hiç olmadığı hâline döner
  (`setSoundFix`, `setEnhance`'in aynı kuralı).
- `targetLufs` yalnızca −16 (`SOUND_FIX_TARGET_LUFS_V6`, zincirin `TARGET_LUFS`'ına birim sınamasıyla
  bağlı). Başka sayı ya da metin **`sound_fix_invalid`**, nesne değilse `not_an_object`, başka alan
  `unknown_field`. Sayının yazılı olması tarifin ne istediğini söylemesi içindir; bilinmeyen bir hedef
  sessizce −16 diye okunmaz. Başka bir hedef gelirse liste genişler, alan değişmez.
- **Kazançlar tarifte yok.** `enhance` gibi tarif yalnızca isteği taşır; ölçü her indirmede o indirmenin
  kendi karışımından alınır. Kesit, ses düzeyi ya da müzik değişince saklanmış bir kazanç yanlış olurdu.
- **Geçiş:** v5 → v6 yalnızca numara (bayt bayt; birim ve e2e). v1…v4 doğrudan v6'ya gelir. `soundFix`
  taşıyan daha eski numaralı bir tarifi hiçbir derleme yazmadı: yükseltilmez, `schema_version_unsupported`.
  Fixture'lar: `web/fixtures/edl/legacy-v5/` (dördü geçerli, `v5-with-sound-fix` geçersiz), geçerli
  `sound-fix-on`, `sound-fix-with-music-and-enhance`, beş geçersiz (`sound-fix-*`), `future-schema` → 7.
- **Geri yol:** yok (ADR-043 Karar 3). Bu kez önceki derleme (v5) "daha yeni kayıt" korumasını taşıyor:
  v6 kaydı görünce okumaz, üstüne yazmaz, başlıkta söyler (ADR-043'ün v4 → v5 penceresi burada kapalı).
- **Render planı:** `soundFix: { targetLufs } | null`; parmak izine yalnızca açıkken girer (zincir
  sürümüyle, `SOUND_FIX_VERSION` — artık kendi küçük modülünde, `soundFixVersion.ts`, ki plan zinciri her
  sayfanın ilk yüküne taşımasın). Kapalı bir tarifin parmak izi v5'teki ile aynıdır (birim sınaması).

## Karar 3 — Ölçüm indirmede, export worker'ında, indirmenin kendi karışımı üzerinde

Kart sesi video seçilince ölçer (ses yüksekliği worker'ı). Editörde bu yanlış olurdu: karışım her düzenlemede
değişir ve ölçülen kazanç bir sonraki düzenlemede bayatlar. Bunun yerine export worker'ı, dosya açılmadan
**önce** (`prepareSoundFix`, ses gecikmesinin ölçümünden sonra, hızlı kesimin kararından önce):

1. **1. geçiş:** karışım olduğu gibi — her kesit kendi kazancıyla, müzik zarfıyla, çıktı hızında (48 kHz):
   `SegmentAudioWriter`'ın kendisi, yalnızca yazmak yerine her parçayı ölçere verir (`measure`). Pay (−1 dB)
   ve kırpıcı uygulanmaz: zincir o payın yerine çalışır. → `R128Meter` (BS.1770) → `inputGainFor`.
2. **2. geçiş:** aynı karışım yeniden çözülür; 1–4. adımlar ve sınırlayıcı (`SoundRehearsal`) → çıkış kazancı.
3. **Karar kartınkiyle aynı:** `decideSoundFix` (zaten iyi, yine de kısık, patlamış) ve sonra `SoundFixChain`.
   İkinci bir ses yüksekliği algoritması **yok**: ölçer, kırpılma sayacı, kazanç kuralları, zincir ve karar
   ADR-049'un kodudur.

- **Patlamış kayıt** (`ClipMeter`) karışımda değil, **videonun kendi sesinde** (kazancı 1, yalnızca duyulan
  kesitlerde) sayılır: müziğin ustalaştırılmış tepeleri bozuk bir kayıt değildir, kullanıcının ses ayarı
  kaydın kendisi değildir (birim sınaması: müzik tepeleri sayılmaz, susturulmuş kesit sayılmaz).
- **Bedel:** sesin iki kez daha çözülmesi ve karıştırılması (ADR-049: zincir + ölçer dakikalık ses başına
  bu makinede ≈ 1,4 sn, artı çözme). Görüntü bu sırada açılmaz.
- **İlerleme gerçektir:** "Sesin dinleniyor…" ve iki geçişin gerçek payı (`analysing`, `subject: 'sound'`).
  "Vazgeç" her parçada bakılır. Bekçi bu adımı kodlama gibi izler (60 sn ses yoksa "durdu"; ADR-042).
- **Kesit indirmesi** yalnızca o kesitin karışımını ölçer; birleşik indirme bütününü. Zincir tek: kazançlar
  kesitten kesite sürer (ADR-049'un `flush` kuralı). Prova (2. geçiş) kesit sınırlarında boşaltılmaz; fark
  küçüktür ve iki kesitlik e2e'de ffmpeg ile ölçüldü (aşağıda).
- **Sesi olmayan indirme** (ses izi yok, her kesit sessiz, müzik yok): ölçüm başlamaz, sonuç söyler.
  **Sessizlik** (−60 LUFS altı): zincir çalışmaz (gürültüyü 40 dB açmak düzeltme değildir), ses olağan
  karışımdır, sonuç söyler.
- **Sesini al** (yalnız ses, M4A) ve **hedef boyut** indirmeleri de aynı ölçümden geçer (aynı karışım, aynı
  kod). Hedef boyutun yeniden denemeleri yeniden ölçmez.

## Karar 4 — Görüntü kopyalanmaya devam eder

`soundFix` hızlı kesimin uygunluğuna (`fastCutEligibility`) girmez: ses her indirmede zaten yeniden
kodlanır (ADR-032'nin öncü örnek hizası), görüntü izin verilen her videoda kopyalanır — kartta olduğu gibi.
Birim sınaması (uygunluk ayar açıkken ve kapalıyken aynı) ve e2e (`data-method="copy"`, her video paketi
kaynağınkiyle bayt bayt aynı, çözülen her kare aynı).

## Karar 5 — İndirmeden sonra ne söylenir (dürüst sonuç)

| Ne bulundu | Satır |
|---|---|
| Düzeltildi | "Ses düzeltildi: daha duyulur ve eşit." (kartın satırı) |
| Zaten iyiydi (±2 LU, ses aralığı < 10 LU, tepe ≤ −1 dBTP) | "Sesin zaten iyiydi; pek bir şey değişmedi." — zincir kartta olduğu gibi yine çalışır; dosya −16'dadır |
| Kazanç yetmedi | "Ses çok kısıktı: olabildiğince açıldı, yine de biraz kısık kalabilir." |
| Videonun sesi yer yer patlamış | ek satır, kartın cümlesi: "Bu kayıtta ses yer yer patlamış. Sesin yüksekliği düzelir, ama patlama gitmez." |
| Sessizlik | "Sesi düzelt açıktı, ama seste duyulacak bir şey yoktu; ses olduğu gibi kaldı." |
| Ses yok | "Sesi düzelt açıktı, ama bu indirmede ses yok." |

Sayılar (önce / tahmin edilen sonra LUFS, kırpılma payı, kazançlar, en derin sınırlama) satırın `data-*`
alanlarındadır; e2e onları okur, ekranda gösterilmez. İngilizcesi `messages.en.ts`'te.

## Yapılmayanlar (ve neden)

- **Editörde önce/sonra dinleme ve "Ses: kısık → normal" ön bilgisi:** karışımı indirmeden önce ölçmeyi,
  her düzenlemede yeniden ölçmeyi ister. Ayrı bir karar (aşağıda).
- **Önizlemede düzeltilmiş ses:** oynatıcı dosyaları olduğu gibi çalar; ayar bunu söyler.
- **Kartta "Daha fazla ayar → editörde aç":** artık mümkün (ayar açık olarak), ama kartın ekranı ve ADR-049'un
  kurucu kararı değişir; yapılmadı (aşağıda).
- **Kesit başına ayar:** yok; bütün karışım tek hedefe gelir.
- Politika belgesi: değişmedi (özellik zaten ücretsiz ve cihazda; nerede sunulduğu bir hak değil).

## Ölçüm (son kod, Playwright'ın Chromium'u, `CLIP_TEST_HOOKS=1` yapısı, ffmpeg `ebur128` ile)

Kaynaklar ADR-049'unkiler (`web/tests/e2e/soundfix-media.ts`; yapay ses, üretilmiş müzik; gerçek kayıt yok).
Editörde açıldı, Ayarlar → Ses → "Sesi düzelt", üstteki "İndir"; kaydedilen dosya ffmpeg ile ölçüldü.

| Kaynak, editörde | Dosya (LUFS · LRA · dBTP) | Görüntü | Sonuç satırı |
|---|---|---|---|
| Kısık konuşma (−37,7) | **−16,0** · 2,6 · **−4,7** | kopya, paketler bayt bayt | Ses düzeltildi |
| Kısık konuşma + müzik (tone-30s, −12 dB) | **−16,0** · 0,1 · **−9,4** | kopya, paketler bayt bayt | Ses düzeltildi |
| Dengesiz konuşma, iki kesit birleşik (5 + 6 sn) | **−16,0** · 4,8 · **−2,8** | kopya | Ses düzeltildi |
| Patlamış konuşma | **−16,0** · 2,7 · **−8,7** | — | + kartın patlama cümlesi |
| Zaten iyi konuşma | **−16,0** · 2,6 · **−4,7** | — | Sesin zaten iyiydi |
| Sessiz ses | −70 (dokunulmadı) | kopya | Sesi düzelt açıktı, ama… |
| Kısık konuşma, yalnız ses (M4A) ve 2 MB hedef boyut | −16 ± 1, ≤ −1 dBTP (sınandı) | — | Ses düzeltildi |
| Kısık konuşma, ayar **kapalı** | −38,7 (kaynak −37,7, olağan −1 dB pay) | — | yok |

Ekranın "önce" sayısı (karışımın kendi ölçümü) ffmpeg'in kaynakta ölçtüğüyle 0,5 LU içinde (müziksiz).
Süreler: görüntü 16,367 → 16,367, ses görüntünün bir karesi içinde.

## Sınamalar (21 Ekim 2026, dal `worktree-agent-a188ae02067a0242f`; hepsi yerel)

| Ne | Sonuç |
|---|---|
| `tsc --noEmit`, `eslint .` | hatasız |
| Birim (vitest) | **1646 / 1646** (94 dosya; 20'si yeni `soundFixSetting.test.ts`; fixture'lardan 12 yeni durum; sürüm numarasını sabit yazan sınamalar 5 → 6) |
| e2e: `sound-fix`, `persistence`, `editor`, `enhance`, `captions`, `transcript-keep`, `audio-only` | ilk koşu 98 sınama: **97 geçti, 1 düştü** (`captions.spec.ts`'te güncellenmeyi unuttuğum sabit "5:0"; sınama düzeltildi, uygulama kodu değişmedi) → `captions.spec.ts` **7 / 7**; sonra iki yeni sınamayla `sound-fix.spec.ts` **23 / 23** (10'u yeni: editörde 9, İngilizce editörde 1; kartın 13 sınaması da geçti). `persistence.spec.ts` **20 / 20** (2'si yeni: ayar saklanır, yenilemede geri gelir, kapatınca alan gider, geri al; v5 kaydı ayar kapalı açılır ve yalnız numarası değişir) |
| e2e `a11y.spec.ts`, Ayarlar ve "Sesi düzelt" alt kümesi | **12 / 12** |
| **Koşulmayan** | tüm e2e takımı, `npm run quality`, bulut yapısı, Pages yapısı, tarayıcı matrisi, gerçek telefon, Safari, Firefox |

## Doğrulanmayanlar

- **Kulakla dinleme** ve **gerçek kayıtlar** (müzikli vlog, iki kişilik röportaj): yalnız yapay ses.
- **"Vazgeç" ölçüm sırasında**: kod her parçada bakar; e2e'de ölçüm 1 sn'den kısa sürdüğü için basılamadı,
  ayrıca sınanmadı. Bekçinin bu adımı izlemesi de sınanmadı.
- **Uzun video:** bir saatlik karışımda iki ek geçişin süresi ölçülmedi (yalnız ADR-049'un hesabı).
- **44,1 kHz kaynak** ve **farklı hızda müzik**: karışım çıktı hızında ölçülür; deneme kaynakları 48 kHz.
- **Prova ile zincirin kesit sınırı farkı** yalnızca iki kesitle ölçüldü; çok sayıda kısa kesitte ölçülmedi.

## Kurucu kararları

1. **Editörde önce/sonra dinleme** isteniyor mu? İstenirse ayar açılınca karışım arka planda ölçülür ve
   her düzenlemede yeniden ölçülür (ses yüksekliği worker'ı karışımı bilmediği için ölçüm export worker'ına
   ya da ortak bir modüle taşınır).
2. **Kartta "editörde aç"** artık mümkün: ayar açık olarak editöre geçilebilir. Eklenip eklenmeyeceği.
3. **Zaten iyi seste** zincir yine çalışıyor (kartın davranışı; dosya her zaman −16'da). Alternatif: hiç
   dokunmamak (o zaman dosya olağan karışımın −1 dB payıyla çıkar ve "−16" sözü tam tutmaz).
