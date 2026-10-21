# ADR-049 — "Sesi düzelt": kısık ya da dengesiz ses, cihazda, duyulur ve eşit

> Tarih: 2026-10-18 · Durum: UYGULANDI (web; birim, e2e, kalite katmanı). Telefonda, Safari'de ve Firefox'ta
> denenmedi. Politika **değişti** (doc 15 `2026-10-18.v12`: Sesi düzelt ücretsiz, cihazda); şema değişmedi
> (EDL v5 — ses düzeltme tarife yazılmaz, sihirbaz proje saklamaz).
> Kaynak: kurucunun onayladığı fikir (yeni kart "Sesi düzelt" / "Fix the sound").
> İlgili: [ADR-018] (ses yüksekliği worker'ı), [ADR-027] (hızlı kesim: görüntü kopyası), [ADR-032] (AAC
> öncü örnekleri ve senkron), [ADR-034](ADR-034-task-first-home.md) (iş kartları ve sihirbaz çatısı),
> [ADR-036] (konuşma algılayıcının seviye ayarı), [ADR-042](ADR-042-export-failure-detail.md) (hata
> ayrıntısı ve bekçi), [ADR-048](ADR-048-english-ui.md) (İngilizce arayüz).

## Bağlam

Telefonla çekilen videoların en sık ses sorunu gürültü değil seviyedir: konuşan telefondan uzaktır, ses
kısık kalır; iki kişiden biri yakın biri uzaktır, biri bağırır gibi öbürü fısıldar gibi duyulur; ya da
tersine, müzik ya da yakın mikrofon bir platformun kısacağı kadar yüksektir. Bunların hepsi bilinen,
yapay zekâ gerektirmeyen ses işlemeyle düzelir. Gürültü silmek (rüzgâr, uğultu, dip ses) ise başka bir
iştir ve 10 Ekim'den beri dürüst bir "Bunu henüz yapamıyoruz." alır; bu kart onu yapmaz ve yaptığını
söylemez.

## Karar

### Ne yapar (zincir, `web/src/domain/soundFix.ts`)

Her örnek için, bütün kanallara **tek** kazançla (stereo görüntü kaymaz):

1. **Hafif alçak kesim:** 60 Hz, 12 dB/oktav (Butterworth). Sesin kendisinde olmayan gümbürtü ve el
   sesi; müziğin basına neredeyse dokunmaz (80 Hz değil, bu yüzden).
2. **Giriş kazancı:** kaynağın bütünleşik ses yüksekliğinden hedefe (en çok ±30 dB).
3. **Yavaş seviye:** konuşma algılayıcının seviye ayarı (ADR-036, `levelNormalise.ts`) — artık çok kanallı
   (`MultiLevelNormaliser`; tek kanallı algılayıcı kopyası örnek örnek aynı, birim sınamasıyla). Dinleme
   için ayarlandı: 50 ms bloklar, 0,5 s geri / 0,5 s ileri bakış, hedef −12 dBFS (2. adımdan sonra sıradan
   konuşmanın yüksek heceleri ≈ −10 dBFS'tir: dokunulmaz), **yalnızca açar**, en çok 15 dB, saniyede en çok
   10 dB yükselir / 40 dB iner, ve arka planından 20 dB yükselmeyen yerde (duraklama, uğultu, sürekli müzik)
   **durur** — gürültüyü konuşmanın üstüne çıkarmaz. Dengesiz konuşmayı eşitleyen budur.
4. **Yumuşak sıkıştırıcı:** 2:1, eşik −18 dBFS (RMS), 6 dB yumuşak diz, 5 ms saldırı / 120 ms bırakma;
   en yüksek heceler biraz iner (deneme kaynaklarında en derin −5,5 dB).
5. **Çıkış kazancı:** 3. ve 4. adımlar ses yüksekliğini değiştirir; ne kadar değiştirdikleri ikinci ölçümle
   bilinir (aşağıda) ve burada düzeltilir (en çok ±12 dB).
6. **Gerçek tepe sınırlayıcı:** 5 ms ileri bakış, tepeler BS.1770-4 Ek 2'nin 4 kat örnekleme süzgeciyle,
   tavan **−2 dBTP**, 60 ms bırakma; kazanç tepe gelmeden iner ve hiç basamak yapmaz. Örnek n giren örnek
   n çıkar (ileri bakış kesitin sonunda geri verilir): ses görüntüye göre kaymaz.

**Hedef −16 LUFS** (bütünleşik, ITU-R BS.1770-4), dosyanın gerçek tepesi **≤ −1 dBTP**. Neden −16:
telefonda dinlenen çevrim içi video ve podcast düzeyi (AES TD1004 akış ve mobil için −16…−20 LUFS önerir;
Apple Podcasts −16 ister). EBU R128'in −23 LUFS'ı oturma odasındaki televizyon içindir; telefon
hoparlöründe bu kartın düzelttiği "çok kısık"tır. YouTube ve Spotify −14'ten yüksek olanı kıstığı için
−16 onlarda kısılmaz ve tavanın altında 15 dB'lik bir pay kalır. Sınırlayıcının tavanı −2: AAC kodlayıcısı
tepelere ≈ yarım desibel ekleyebilir, dosyanın sözü −1'dir (ölçülen: aşağıda).

### Ölçüm: iki geçiş, ses yüksekliği worker'ında (ADR-018'in worker'ı)

Ölçer yeni (`web/src/domain/r128.ts`): K süzgeci (her örnekleme hızı için yeniden türetilir), 400 ms
blok / 100 ms adım, −70 LUFS mutlak ve −10 LU göreli kapı, EBU Tech 3342 ses aralığı (LRA), 4 kat
örneklenmiş gerçek tepe. `loudness.ts`'in 10 ms RMS zarfı yeniden kullanılmadı: o sessizlik bulmak içindir,
K ağırlığı ve kapısı yoktur; başka bir ölçerin (ffmpeg) okuduğu sayıyı tutturmak için BS.1770 gerekir.
Deneme kaynaklarında ölçerimiz ile ffmpeg `ebur128` aynı sayıyı verdi (0,1 LU içinde; e2e her
kaynakta ≤ 0,5 LU'yu sınar).

Dışa aktarma akış hâlinde çalışır (sesin tamamı bellekte tutulmaz); bütünleşik ses yüksekliğini hedefe
getirmek ise sesin tamamını bilmeyi ister. Bu yüzden sihirbaz, video seçilince worker'a `soundCheck`
sorar:

- **1. geçiş:** ses olduğu gibi (indirmenin karıştırdığı gibi: kanal c = kaynak kanalı c mod n) ölçülür →
  giriş kazancı. Ekrandaki "önce" sözü buradan gelir.
- **2. geçiş:** ses yeniden çözülür, 1–4. adımlar ve sınırlayıcı giriş kazancıyla çalıştırılır, sonucu
  ölçülür → çıkış kazancı. Çıkış kazancı sınırlayıcıdan önce uygulandığından sınırlayıcının payı biraz
  değişir; ölçülen sapma ≤ 0,05 LU (aşağıdaki tablo).

İki geçiş, dakikalık ses başına bu makinede ≈ 1,4 sn işlem (ölçer 0,33 sn, zincir + ölçer 1,06 sn) ve
iki kez çözme; ilerleme çubuğu gerçek paydır, "Vazgeç" worker'ı hemen durdurur, bekçi (ADR-042) duran ya da
çöken worker'ı bir dakikada söyler. Aynı oturumda aynı video ikinci kez ölçülmez (en çok 4 video).

### Ekran (sihirbaz çatısı, yeni yerleşim yok)

Videonu seç → tek ekran → İndir. İkinci ekran:

- "Sesin daha duyulur ve eşit olur; görüntüye dokunulmaz." — **yalnızca** dışa aktarmanın kendi denetimi
  (yeni `copyCheck` isteği: hızlı kesimin uygunluk, paket tarama ve kesim planı; hiçbir şey çözülmez,
  kodlanmaz, yazılmaz) bu videonun görüntüsünün kopyalanacağını söylerse. Kopyalanamayan videoda (WebM,
  HEVC, 60 fps, 1080p'den büyük…) "Görüntü de yeniden işlenir: bu video olduğu gibi kopyalanamıyor.";
  denetim cevap vermezse görüntü hakkında hiçbir söz verilmez. Sonuç satırı her zaman olanı söyler
  ("Görüntüye dokunulmadı…" / "Görüntü yeniden işlendi (…)" + "Ses düzeltildi: daha duyulur ve eşit.").
- "Ses: çok kısık → normal" (beş söz: çok kısık / kısık / normal / yüksek / çok yüksek; hedeften
  −12, −2, +2, +8 LU sınırlarıyla). Ses aralığı ≥ 10 LU ise "Bazı yerler ötekilerden kısıktı; onlar da açılır."
- "Gürültüyü silmez: rüzgâr ve uğultu da sesle birlikte açılır. Kendi videon değişmez."
- "Dinle (5 sn): Önce / Sonra": sesin en kısık ama çoğunlukla ses olan 5 saniyesi (bir kısık konuşmacı
  değişikliğin asıl işidir), 2. geçişte olduğu gibi ve zincirden geçmiş hâliyle tutulur; sayfanın kendi
  ses çıkışından çalar, biri çalarken öbürü durur, aynısına basmak durdurur. Hiçbiri saklanmaz.
- **Zaten iyi** (±2 LU içinde, ses aralığı < 10 LU, gerçek tepe ≤ −1 dBTP): "Sesin zaten iyi. Yine de
  indirebilirsin; pek bir şey değişmez." — indirme açık kalır.
- **Kazanç yetmezse** (çok kısık kaynak, sonuç hedefin 2 LU altında kalacaksa): "olabildiğince açılır, yine
  de biraz kısık kalabilir".
- **Sesi olmayan video:** "Bu videoda ses yok; düzeltilecek bir ses yok." (Sesini al'ın cümlesinin bu işe
  uyan hâli; ölçüm hiç başlamaz, İndir kapalı.) **Sesi sessizlik olan video** (−60 LUFS altı): "Bu videonun
  sesinde duyulacak bir şey yok; açılacak bir ses bulunamadı." — gürültüyü 40 dB açmak düzeltme değildir.
- **"Daha fazla ayar → editörde aç" yok:** editör bu zinciri bilmez; oradan indirilen video sesini olduğu
  gibi taşırdı. Bağlantıyı göstermek, ses düzelecekmiş gibi bir söz olurdu (kurucu kararı: aşağıda).

### Dışa aktarma

Kazançlar indirme isteğiyle gider (`ExportExtras.soundFix` → `soundFix` isteği; worker yalnızca kendi zincir
sürümünün sayılarını kabul eder, `usableSettings`). Zincir `SegmentAudioWriter`'da, karışımın ortak payı
(−1 dB) ve kırpıcının yerine çalışır; tam kodlamada da hızlı kesimde de aynı kod. Ses her zaman yeniden
kodlanır (ADR-032'nin öncü örnek hizası korunur); görüntü hızlı kesimin izin verdiği her videoda kopyalanır.

## Ölçüm (son kod, Playwright'ın Chromium'u, ffmpeg 9.0.1 `ebur128` ile)

Deneme kaynakları `web/tests/e2e/soundfix-media.ts` (ffmpeg'in kendi yapay sesi `flite`, üretilmiş müzik,
sessizlik, kırpılmış kayıt; 640 × 360 30 fps H.264, her saniye anahtar kare) ve
`scripts/lib/av-sync.mjs`'in senkron klibi (1080 × 1920):

| Kaynak | Önce (LUFS · LRA · dBTP) | Sonra, dosya (LUFS · LRA · dBTP) | Görüntü | Süre (görüntü / ses) |
|---|---|---|---|---|
| Kısık konuşma | −37,7 · 3,6 · −27,3 | **−16,0** · 2,6 · **−4,7** | kopya | 16,367 → 16,367 / 16,384 |
| Dengesiz konuşma (ikinci satır 22 dB kısık) | −18,4 · **22,7** · −8,3 | **−16,0** · **5,4** · **−3,0** | kopya | 16,367 → 16,367 / 16,384 |
| Zaten iyi konuşma | −15,3 · 3,6 · −4,9 | **−16,0** · 2,6 · **−4,7** | kopya | 16,367 → 16,367 / 16,384 |
| Kırpılmış (patlamış) konuşma | −1,1 · 2,8 · +1,8 | **−16,0** · 2,7 · **−8,7** | kopya | 16,367 → 16,367 / 16,384 |
| Yüksek müzik | −7,3 · 0,0 · −0,3 | **−16,0** · 0,0 · **−8,7** | kopya | 18,000 → 18,000 / 18,005 |
| Senkron klibi | −13,3 · 0,5 · −4,0 | **−16,0** · 0,6 · **−2,5** | kopya | 12,000 → 12,000 / 12,011 |
| WebM (VP9 + Opus, 2 sn) | −21,8 · 0,0 · −17,9 | **−16,0** · 0,0 · **−14,6** | yeniden kodlandı | 2,0 |
| Sessiz ses | −70 (sessizlik) | indirme sunulmadı | — | — |

- **Senkron:** 37 parıltının 37'si eşleşti; ses–görüntü kayması kaynakta 0,08 ms, düzeltilmiş dosyada
  0,08 ms (ortanca, en az, en çok aynı).
- **Görüntü baytları:** her video paketi kaynağınkiyle bayt bayt aynı; yalnızca **ilk** anahtar karenin
  önüne kaynağın kendi parametre kümeleri (SPS, PPS; 38 bayt) eklenir — her hızlı kesim kopyasının
  yaptığı gibi (ADR-027). Çözülen her kare kaynağınkiyle aynı (framemd5).
- **Sınırlayıcı** beş konuşma ve müzik kaynağında hiç devreye girmedi (aynı zincir, ffmpeg ile çözülen
  sesle Node'da çalıştırıldı: en derin sınırlama 0,0 dB; sıkıştırıcı ve hedef tepeleri zaten tavanın altında
  bıraktı); birim sınamasında 4 kat yükseltilmiş müzikte −6 dB'den derin indi ve gerçek tepe −2 dBTP'nin
  0,1 dB içinde kaldı.

## Arama ("Yaz, bulalım")

Yeni sözcükler seviyeyi söyler ("kısık", "duyulmuyor", "ses seviyesi", "volume", "too quiet", "normalize"),
çiftler sesi ve ona yapılanı ("sesi biraz yükselt", "the audio is way too low"); "ses" / "sound" tek başına
Sesini al'da, "sessiz" / "quiet" tek başına Boşlukları at'ta, gürültü sözcükleri "henüz yapamıyoruz"da kalır.
Ayar tabloları ve eski kör kümeler değişmedi (her sayı kartın eklenmesinden önceki ile aynı: Türkçe yeni
küme ilk satır %77,2, yanlış ama emin %3; İngilizce kör küme %76,2 / %2,6). "duyulmadı" güçlü sözcük
yapılmadı: yazım payı onu "duyulmasın"a (Sesi kapat) yaklaştırıyordu.

**Yeni kör küme** (dördüncü; yazar yalnızca iş listesini ve açıklamaları gördü, kodu ve sözcük listelerini
görmedi; 131 Türkçe + 131 İngilizce ifade, her dilde 35'i Sesi düzelt, 25'i komşu işler; ayar tablolarında
geçen ifadeler sayılmadı; BİR KEZ ölçüldü, kaçanlarına bakılmadı). Kartsız (önce) → kartlı (sonra):

| | Türkçe (81 sayılan) | İngilizce (99 sayılan) |
|---|---|---|
| Doğrudan doğru (yapılabilen işler) | %37,5 → %71,9 | %45,8 → %76,4 |
| İlk satır doğru | %46,9 → %87,5 | %51,4 → %90,3 |
| İlk üçte | %46,9 → %93,8 | %52,8 → %93,1 |
| Yanlış ama emin | %4,9 → %0 | %3 → %2 |
| Yapılabilen işte sorma | %51,6 → %28,1 | %27,8 → %20,8 |
| Yalnız Sesi düzelt ifadeleri: doğrudan / ilk üçte / yanlış ama emin | 23 / 30 / 0 (34'ten) | 22 / 29 / 0 (33'ten) |
| "Bunu henüz yapamıyoruz." yakalama · isabet | %92,9 · %100 (değişmedi) | %81,8 · %100 (değişmedi) |

Küme dosyası depoya konmadı (`tests/quality/data`'ya eklemek bir sonraki arama işinin kararı; artık
ölçülmüş sayılır).

## Doğrulanmayanlar

- Gerçek kayıtlar (rüzgârlı dış çekim, iki kişilik röportaj, müzikli vlog): yalnızca yapay ses ve üretilmiş
  müzikle ölçüldü. Kulakla dinleme testi yapılmadı (sıkıştırma ve seviyenin "doğal" duyulup duyulmadığı).
- Gerçek telefon, Safari, Firefox; bir saatlik videoda iki geçişin süresi ve belleği. Ölçülen: 10 dakikalık
  yapay kaynakta (640 × 360) video seçilinceden özet ekranına 20,3 sn, kopya indirme 12,1 sn (bu makine,
  Playwright'ın Chromium'u); bir saat için yalnızca hesap (≈ 2 dk ölçüm).
- 44,1 kHz kaynakta ölçüm kaynağın hızında, dışa aktarma 48 kHz'de çalışır; fark deneme kaynaklarında
  ölçülmedi (yalnızca 48 kHz kaynaklar).
- Bir kaynağın sesi videodan kısa ya da uzunsa ölçüm videonun boyuyla sınırlıdır; böyle bir kaynak
  denenmedi.

## Kurucu kararları

1. **Hedef −16 LUFS** (EBU R128'in −23'ü değil); gerekçe yukarıda. Başka bir hedef tek sabit
   (`TARGET_LUFS`).
2. **Editör bağlantısı yok** bu kartta. Alternatif: editöre bir "Sesi düzelt" ayarı eklemek (tarif şeması
   v6, ayrı iş). — **21 Ekim 2026:** editör ayarı yapıldı ([ADR-050](ADR-050-sound-fix-in-editor.md), EDL v6);
   kartın "editörde aç" bağlantısı hâlâ yok (ADR-050 "Kurucu kararları 2").
3. **Kırpılmış sesin bozukluğu** düzelmez, yalnızca kısılır; ekran bunu ayrıca söylemiyor (kelime bütçesi).
   İstenirse "Kaydın bazı yerleri bozuk; o yerler düzelmez" satırı eklenebilir.
4. **Sesi olmayan video** için Sesini al'ın cümlesi yeniden kullanılmadı ("ses dosyası çıkmaz" bu işe
   uymuyor); aynı biçimde yeni bir cümle yazıldı.
