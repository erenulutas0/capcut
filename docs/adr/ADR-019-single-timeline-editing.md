# ADR-019 — Tek zaman çizgisi: kesme akışı CapCut'taki gibi

> Tarih: 2026-09-22 · Durum: KABUL EDİLDİ (kurucu: "CapCut gibi tek zaman çizgisi")
> Kapsam: web editörünün ana kesme akışı. EDL v2 şeması **değişmedi** (belge 10):
> `clips` hâlâ çıktı sırasındaki saklanan aralıklardır.

## Neden: ilk gerçek kullanıcı testi başarısız oldu

Kullanıcı 1:50 uzunluğunda dikey bir telefon videosuyla denedi. Gözlenenler:

1. **Kırpma "başa dönüyordu".** Alttaki "Çıktı sırası" şeridi tek anı her zaman
   %100 genişlikte gösteriyordu. Kullanıcı tutamağı sürükleyip bırakınca an aynı
   görünüyordu; oysa sessizce 0,2 saniyeye inmişti. Sürüklemenin ne kadar kestiği
   hiçbir yerde görünmüyordu.
2. **İki saat birbirine karıştı.** Kaynak önizlemesindeki oynatma çizgisi
   (Kaynak zamanı, 00:26) seçili anın kaynak aralığında değildi; "Böl"
   "Oynatma çizgisi seçili anın içinde değil…" dedi. Kaynak kaydırıcısı ile çıktı
   şeridi iki ayrı zaman gösteriyordu ve kullanıcı hangisinin geçerli olduğunu
   anlayamadı.
3. **Artık kırıntılar birikti** ("01 · 0.2 sn"). Kullanıcının yorumu: "asıl
   yapacağım hiç basit değil".
4. Ayrıca **"Video bu sürümdeki 60 dakika sınırının üzerinde."** hatası 1:50'lik
   videonun altında kaldı. Kullanıcı başka (uzun) bir videoyu açmayı denemişti;
   o reddedilmiş, açık video değişmemişti. Mesaj hangi dosyadan söz ettiğini
   söylemiyordu.

Kök neden tek: ana akış "önce kaynakta aralık seç, sonra ekle" üzerine kuruluydu;
zaman çizgisi yalnızca bir özetti. Kullanıcı ise (CapCut alışkanlığıyla) videoyu
zaman çizgisinde açıp orada bölmeyi ve silmeyi bekliyordu.

## Karar

**Tek zaman çizgisi, tek oynatma çizgisi, çıktı zamanında.**

| Konu | Karar |
|---|---|
| Video açılınca | Süre ≤ çıktı sınırı (`WEB_LOCAL_POLICY.maxOutputDurationUs`, 5 dk) ise videonun **tamamı tek parça** olarak zaman çizgisine konur; önizleme Sonuç'a geçer; kısa bir onay okunur ("Video zaman çizgisine tek parça olarak eklendi (1 dk 50,0 sn)… Geri al: Ctrl+Z"). |
| Geri alma | Parça, içe aktarmanın **üstünde ayrı bir geri alma adımıdır**. İlk Ctrl+Z zaman çizgisini boşaltır, video açık kalır ("Tüm videoyu ekle" / "Aralık seçerek ekle" sunulur); ikinci Ctrl+Z içe aktarmayı geri alır (eski davranış). Tek adım yapılsaydı ilk Ctrl+Z kullanıcıyı "video görünüyor ama tarifte yok" yarım durumuna düşürecekti. |
| 5 dakikadan uzun video | **Sessizce kesilmez.** Zaman çizgisinde açık bir seçim çıkar: "İlk 5 dakikayı ekle" veya "Aralık seçerek ekle" (mevcut aralık formu, Kaynak önizlemesi), ve 5 dakikalık çıktı sınırı söylenir. |
| Oynatma çizgisi | Zaman çizgisinin üstünde, **çıktı zamanında**. Cetvele veya parçaya tıklamak/sürüklemek önizlemeyi oraya götürür (ve oradaki parçayı seçer). Oynatma çizgisi odaklanabilir bir `slider`: ←/→ 1 kare, Shift ile 1 sn, Home/End. Space oynat/duraklat aynı. |
| Önizleme | En az bir parça varsa varsayılan **Sonuç**. Zaman çizgisi boşsa Sonuç gösterilemez; önizleme Kaynak'tır (türetilmiş durum, efekt yok). |
| Böl (düğme + S) | **Oynatma çizgisinin altındaki parçayı** oradan böler; önceden seçim gerekmez. Bölünen ikinci yarı seçilir (hemen "Sil" denebilir). Yalnızca iki durumda reddedilir ve nedeni söylenir: bir parça kenarına 0,1 sn'den yakınsa, 20 parça sınırı doluysa. "Seçili anın içinde değil" hatası normal akışta artık yok. |
| Sil (düğme + Delete/Backspace) | Seçili parçayı siler, kalanlar birleşir, tek geri alma adımı. Oynatma çizgisi silinen parçanın başladığı yere gider; klavye odağı oynatma çizgisine döner. Seçili parça belirgin: vurgu rengi 2 px kenarlık, halka, kalın etiket, `aria-pressed`. |
| Kenar sürükleme | Ölçek **sürükleme boyunca donuk** (basışta px/µs hesaplanır). Kesilen kısım taralı koyu "hayalet", eklenen kısım vurgu renkli kesik çizgiyle görünür; tutamağın üstünde canlı etiket ("40,0 sn (−10,0 sn)"). Bırakınca kibar bir onay (`role=status`): "Parça 02 kısaltıldı: 50,0 sn → 40,0 sn · Geri al: Ctrl+Z". |
| Kırıntı önleme | **Seçilen yol: en kısaya yapıştırma.** Sürükleme (ve kenar ok tuşları) bir parçayı **0,5 sn'den** kısa bırakamaz; tutamaç orada durur ve onay bunu söyler ("… sürüklenerek 0,5 sn sürenin altına inemez; orada durdu"). Onay penceresi yerine bu seçildi: sürüklemenin ortasında soru sormak akışı böler, yapıştırma ise hem görünür hem geri alınabilir. Zaten 0,5 sn'den kısa bir parça yalnızca uzatılabilir. Tarifin kendi alt sınırı (0,1 sn; yazılan aralık, bölme) değişmedi. |
| Ölçek düzenlemeden sonra | Kırpma veya silme **şeridi yeniden ölçeklemez**: şerit önceki uzunluğu temsil etmeye devam eder, kesilen süre taralı boş alan olarak görünür. "Sığdır" düğmesi ölçeği bilerek günceller. Böylece "bırakınca başa dönüyor" hissi ortadan kalkar. Ayrı bir yakınlaştırma (+/−, Ctrl+tekerlek) eklenmedi. |
| Kelime | Zaman çizgisindeki birim artık **"parça"** (İngilizce "clip"). "An" Türkçede "şu an" ile karışıyordu ("seçili anın" / "şu anki zaman"). Bütün arayüzde (tr + en) tutarlı: sekme "Parçalar", sayaç "2 parça", tutamaç "Parça 01 başlangıcı", sessizlik ve altyazı metinleri. |
| Reddedilen dosya | Mesaj dosyanın adını (güvenli, kısaltılmış) ve açık videonun değişmediğini söyler: "“uzun-video.mp4” açılamadı: video bu sürümdeki 60 dakika sınırının üzerinde. Açık olan videon değişmedi." Açık video yoksa ikinci cümle yazılmaz. Mesaj kapatılabilir (×) ve bir sonraki başarılı işlemde (içe aktarma veya düzenleme) kendiliğinden temizlenir. |

## Ne değişti (kod)

- `web/src/domain/timelineEdit.ts` (yeni, saf): `initialPlacement` (tam parça /
  çok uzun / çok kısa), `leadingRange`, `pieceAtOutput`, `pieceAtSource`,
  `splitAtPlayhead`, `outputStartOf`, `playheadAfterRemoval`,
  `timelineReferenceUs` + `floorAfterEdit` (düzenleme sonrası ölçek),
  `freezeScale` / `pointerToOutputUs` / `dragTargetUs` (donuk ölçek),
  `resolveEdgeTrim` + `dragMinimumUs` (0,5 sn yapıştırma).
- `web/src/domain/trim.ts`: `trimBounds` / `resolveTrimTarget` isteğe bağlı bir
  en kısa uzunluk alır (varsayılan eski 0,1 sn).
- `web/src/application/commands.ts`: `splitAtTimelinePlayhead`, `addWholeSource`,
  `addLeadingSource` (saf, birim testli).
- `useEditorState`: içe aktarma sonucu döndürür ve tam parçayı ayrı adım olarak
  ekler; `deletePiece`, `splitPiece`, `trimPiece`, `addWholeVideo`,
  `addLeadingMinutes`; `MediaError` dosya adını ve "açık video kaldı" bilgisini
  taşır; komutlar ortak `runCommand` ile tek adımda işlenir.
- `usePlayback`: `seekOutput` yeni tarifle çağrılabilir (düzenlemeden hemen
  sonra), `peekSource` sürüklenen kenarın karesini saati kaydırmadan gösterir;
  duraklatılmış saat artık kendiliğinden parça atlamaz.
- `OutputStrip` (zaman çizgisi), `TrimHandle`, `EditorApp`, `LeftPanel`
  (parça başına Böl düğmesi kaldırıldı — tek "Böl" var), `HelpDialog` (Delete ve
  oynatma çizgisi kısayolları), alt bilgi kısayolları, `messages.ts` (tr + en).

## Ne kalmadı değişmeden

EDL v2 şeması ve doğrulama; komutların saf olması; her kullanıcı eylemi tek geri
alma adımı; Kaynak aralık akışı (başlangıç/bitiş alanları, I/O, "Aralığı ekle",
parça düzenleme) ikincil yol olarak yerinde; altyazılar (sonuca ve görüntüye
bağlı), sessizlik önerileri, müzik, dışa aktarma, yeniden bağlama, yerel kayıt ve
yedek dosyası. Gizli dosya seçicileri hâlâ yalnızca hidrasyondan sonra çizilir.

## Sınırlar

- Çıktı en fazla **5 dakika** (politika 2026-09-21.v2); daha uzun videonun
  tamamı tek parça olamaz. Kaynak sınırı 60 dakika, 20 parça.
- Görsel yakınlaştırma yok: uzun zaman çizgisinde 1 px ≈ 0,1–0,3 sn. Kesin konum
  için oynatma çizgisi klavyeyle (kare / saniye) taşınabilir.
- Önizleme hâlâ tek `<video>` ile sıralı oynatmadır; parça geçişinde kısa bekleme
  olabilir (dosyada boşluk yoktur).
- Yeni açılan dikey videoda tuval oranı yine varsayılan 16:9'dur (değişmedi).

## Test edilen

`npx tsc --noEmit -p .`, `npx eslint .`, `npx vitest run` (301 → 327; yeni
`tests/unit/timelineEdit.test.ts` 26 test), `npm run build`,
`E2E_PORT=3101 npx playwright test` (yeni `tests/e2e/timeline.spec.ts`:
kullanıcı hikâyesi 1:50 dikey video ile — tek parça, şeride tıklama, Böl, S,
seçip Delete, kenar sürükleme + hayalet + etiket + onay, geri al/ileri al,
0,5 sn yapıştırma, dışa aktarma; 390 px'te gerçek dokunma olaylarıyla; 5 dk'dan
uzun video seçimi; reddedilen dosya mesajı), GitHub Pages duman testi
(`/capcut` alt yolu). Axe taraması 0 ihlal; klavye akışı yeni modele göre
yeniden yazıldı. Ekran görüntüleri: `web/screenshots/timeline-*.png`.

Değişen eski testler: aralık akışını sınayan testler artık boş zaman çizgisinden
başlar (`tests/e2e/rangeFlow.ts`: içe aktarmadan sonra bir Ctrl+Z); "an" →
"parça" metinleri; kaynak modunda bölme reddinin yeni metni; 0,1 sn yerine
0,5 sn sürükleme sınırı; sonuç modunda kırpmanın artık Kaynak'a geçmemesi;
parça başına Böl düğmesi testi yerine "seçim bölmeyi engellemez" testi; farklı
dosyayı yeni kaynak olarak kabul edince tek tam parça.

## Test edilmeyen

- **Gerçek dokunmatik cihaz yok.** 390 px testi Chromium'a CDP ile gerçek dokunma
  olayları gönderir (`pointerType: touch`), fakat telefon parmağı, avuç teması,
  kaydırma ile sürüklemenin çakışması ve iOS Safari denenmedi.
- **Gerçek ekran okuyucu yok** (NVDA, VoiceOver, TalkBack). Adlar, `aria-valuetext`
  ve `role=status` duyurusu erişilebilirlik ağacında doğrulandı; ne okunduğu ve
  zamanlaması doğrulanmadı.
- Yalnızca Chromium; Firefox ve Safari'de sürükleme ve klavye akışı denenmedi.
- İkinci bir kullanıcı testi yapılmadı: "parça" kelimesinin ve 0,5 sn
  yapıştırmanın gerçekten daha anlaşılır olduğu varsayımdır.
