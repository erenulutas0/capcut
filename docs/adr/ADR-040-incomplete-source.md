# ADR-040 — Yarım kalmış (yarıda inmiş / yarıda kopyalanmış) video: seçildiği anda reddedilir

> Tarih: 2026-10-10 · Durum: UYGULANDI (MP4 / MOV; birim ve e2e testleri, kalite katmanı).
> Politika (belge 15) ve şema (EDL) **değişmedi**. Kaynak: kalite raporunun 10 Ekim bulgusu
> (`docs/quality/bulgular.md`, madde 2).

## Bağlam

İndirmesi ya da kopyalanması yarıda kalmış bir MP4'te dizin (`moov`) dosyanın başındaysa — telefonların
ve çoğu sitenin ürettiği dosyalar böyledir — tarayıcı dosyayı açar ve **tam süreyi** gösterir ("24,0 sn"):
dizin bütün kareleri listeler, ama dosyanın sonundaki karelerin baytları yoktur.

10 Ekim ölçümünde (baytlarının %55'i olan dosya, on sihirbaz):

- *Sesini al:* 24 saniyelik bir ses dosyası kaydedildi, "Ses dosyası kaydedildi" dendi; son bölüm sessizlik (−91 dB).
- *Boşlukları at:* "24,0 sn" gösterilen videodan 12,5 saniyelik bir dosya kaydedildi. Uyarı yok.
- *Diğer yedi sihirbaz:* "Bu tarayıcı videonun bazı karelerini çözemedi. … Chrome veya Edge ile dene." —
  ölçüm Chromium'daydı; sorun dosyada. Kullanıcı başka tarayıcı kurar ve aynı cümleyi görür.

Kurucu kuralı: çalışmayan şeye başarı mesajı yok. Sonu eksik ya da sessiz bir dosyaya "Kaydedildi" demek
bunun ihlali; dosyadaki sorunu tarayıcıya yüklemek de kullanıcıyı yanlış yöne göndermek.

## Karar

**Tek davranış, her yerde: yarım dosya, seçildiği anda reddedilir.** On sihirbaz, editör, "dosyayı
yeniden seç" (yeniden bağlama) ve müzik dosyası aynı kapıdan (`probeFile`) geçer; hepsi aynı cümleyi söyler:

> "tatil.mp4" açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada
> yalnızca ilk 13,1 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya
> da yeniden kopyala, sonra tekrar dene.

Cümle üç şeyi söyler: ne olduğu (dosya yarım), ne kadarının orada olduğu, ne yapılacağı. Tarayıcıdan söz
etmez.

### Neden "olanı kaydet, 'yalnızca ilk X saniye okunabildi' de" değil

İkisi de dürüsttür; reddetmek seçildi, çünkü:

1. **Kullanıcının istediği o dosya değildir.** Yarım inmiş bir videonun çaresi neredeyse her zaman
   yeniden indirmektir; uygulama ilk yarıyı işleyip verirse çocuk "oldu" sanır ve eksik videoyu paylaşır.
   Kırmızı bir uyarı satırı, "Kaydedildi" başlığının yanında okunmaz.
2. **Tek cümle, tek yer.** "Olanı kaydet" on sihirbazın her birinde ayrı anlama gelir (Boşlukları at
   yarım sesi mi arasın, Küçült hangi süreye göre plan yapsın, Dikey yap'ın önizlemesi 13. saniyeden sonra
   ne göstersin); editörde zaman çizelgesi, önizleme oynatıcısı ve kesit sınırları tarayıcının söylediği
   24 saniyeye göre çalışır. Reddetmek tek yerde, tek kuralla yapılır ve hiçbir ekran yalan söylemez.
3. **Kaybedilen şey ölçülebilir ve küçüktür:** elindeki tek kopya yarımsa kullanıcı ilk yarıyı bu
   uygulamayla kurtaramaz. Bu bilinçli bir bedeldir (aşağıda "Kurucuya soru").

### Nasıl anlaşılır (`web/src/adapters/sourceIntegrity.ts`)

Dizin okunur, video çözülmez. Görüntü ve ses izinin her biri için dizinin listelediği **son paketin**
baytları istenir; okunamıyorsa dosya yarımdır. O zaman kısa bir ikili arama dosyanın gerçekte nereye
kadar gittiğini bulur (cümledeki "ilk 13,1 sn"; görüntü ve sesten önce biteni). Birkaç küçük okuma:
24 saniyelik örnekte Node'da yaklaşık 15 ms (bellekteki dosya); tarayıcıda ve büyük dosyalarda süresi
ayrıca ölçülmedi, üst sınırı 4 saniyedir.

- **Yalnızca MP4 / MOV** (dizini her karenin yerini söyleyen kaplar). Başka kaplar ve 4 saniyede cevap
  vermeyen dosyalar için sonuç `unknown`'dır: **hiçbir şey iddia edilmez**, akış eskisi gibi sürer.
- **Son 1 saniyeden azı eksikse ret yok** (`INCOMPLETE_TOLERANCE_US`): birkaç bayt eksik bir dosyayı
  oynatıcılar da dışa aktarma da (ADR-014'ün %2 kare payı) taşır.
- Dizini **sonda** olan yarım dosya hiç açılamaz; o zaten "bu dosyanın önizlemesi açılamadı… Başka bir
  video dene" cümlesiyle reddediliyordu (değişmedi).

### İkinci kapı: dışa aktarmanın kendisi

Aynı denetim işçide, **hiçbir şey çözülmeden ve yazılmadan önce** bir kez daha yapılır (`runExport`,
`runAudioExport`: `refuseIncompleteSource`). Sayfadaki denetimi herhangi bir yoldan aşan yarım dosya
`source_incomplete` ile biter: "Bu video yarım kalmış görünüyor: sonu dosyada yok. … Videoyu yeniden indir
ya da yeniden kopyala, sonra tekrar dene." Hiçbir yol — video, yalnızca ses, hızlı kesim — sonu eksik bir
dosyayı kaydedip başarı diyemez. Kaydetme penceresinin oluşturduğu boş dosya da geri alınır (önceden,
dosya açılmadan gelen retlerde seçilen adda 0 baytlık bir dosya kalıyordu).

### "Chrome veya Edge ile dene" yalnızca tarayıcı gerçekten sorun olabiliyorsa

- `source_frames_missing` ve `no_frames_decoded` cümleleri artık tarayıcıyı suçlamaz: "Videonun bazı
  bölümleri okunamadı… Video bozuk olabilir: başka bir oynatıcıda sonuna kadar oynuyor mu bak. Bozuksa
  videoyu yeniden indir ya da yeniden kopyala."
- "Video başka yerde sorunsuz oynuyorsa sorun bu tarayıcıda olabilir: Chrome ya da Edge ile dene." ayrı
  bir satırdır ve **yalnızca Chromium olmayan tarayıcıda** gösterilir (`isChromiumBrowser`: tarayıcının
  marka listesi, yoksa kullanıcı aracısı; bilinmiyorsa gösterilmez — öneri vermemek, yanlış öneriden iyidir).

## Testler

- Birim (`tests/unit/sourceIntegrity.test.ts`, 9): depodaki örnek, dizini başa alınıp (mediabunny ile,
  paketler kopyalanarak) baytlarının %10–95'inde kesilir: hepsi `incomplete`, okunabilir bölüm baytla
  birlikte büyür ve gerçekten okunur; tam dosya ve sondan 40 bayt eksik dosya `complete`; dizinsiz kap,
  video olmayan dosya, cevap vermeyen dosya `unknown`; cümleler (TR/EN) ve hiçbirinde tarayıcı adı yok.
- e2e (`tests/e2e/incomplete-source.spec.ts`, 11): on sihirbazın onu, editör (açık video yerinde kalır),
  müzik dosyası; tam dosya yanlışlıkla reddedilmez; sayfadaki denetim test kancasıyla kapatılınca
  (`__clipSkipImportIntegrity`) Sesini al, Sesi kapat, Dikey yap, Her yerde açılsın ve Boşlukları at
  "Bu sefer olmadı" ile biter, "Kaydedildi" görünmez, hiçbir dosya kalmaz, tarayıcı adı geçmez.
- Kalite katmanı: bölüm 3'ün "Yarıda kesilmiş MP4" satırı (sayılar `docs/quality/latest.md`).

## Kapsam dışı / ölçülmeyen

- **MP4 / MOV dışındaki kaplar** (WebM, MKV): dizinleri her karenin yerini söylemez; yarım bir WebM
  çoğu zaman süresi bilinmediği için zaten "süresi okunamadı" ile reddedilir, ama bu burada ölçülmedi.
- **Baytları yerinde ama bozuk dosya** (bazı indiriciler dosyanın yerini baştan ayırır ve gelmeyen
  bölümü sıfırla doldurur): dizine bakarak anlaşılamaz. Dışa aktarma eksik karelerde durur
  (`source_frames_missing`) ve artık dosyanın bozuk olabileceğini söyler; ses yolunda sıfır dolu bölüm
  sessizlik olarak çıkar — bu durum **denenmedi**.
- **Parçalı (fragmented) MP4** ve gerçek telefon kayıtları üzerinde ayrıca ölçüm yapılmadı; denetim 4
  saniyeyle sınırlı ve cevap gelmezse `unknown`.
- Gerçek bir "yarıda kalmış indirme" (tarayıcının `.crdownload` dosyası gibi) denenmedi; test dosyası
  tam bir dosyanın baştan %N'idir.

## Kurucuya soru

Yarım dosyanın **okunabilen ilk bölümünü yine de açmak** ("Yine de aç: yalnızca ilk 13 saniye") istenir
mi? Bugün yok. Eklenirse video o uzunlukta bir video gibi açılmalı (süre, önizleme, kesit sınırları) ve
her sonuç ekranı bunu söylemeli; editörün oynatıcısı tarayıcının bildirdiği süreyle çalıştığı için küçük
bir iş değildir.
