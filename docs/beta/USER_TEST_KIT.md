# Beta kullanıcı testi kiti

> Tarih: 2026-09-22 · Kaynak: `transcript_araştırma/04` §Gerçek kullanıcı deneyi,
> belge 03 (hedef kitle doğrulama), belge 34 §E. Maliyet: 0 (görüşmeler çevrim içi ya da
> yüz yüze; kayıt isteğe bağlı ve katılımcı izniyle).

## Amaç

Tek soru: **Video düzenleme bilmeyen biri, yardım almadan, kendi videosundan
paylaşılabilir kısa bir klip çıkarabiliyor mu?** Özellik istek listesi toplamak değil;
tıkanılan yerleri görmek. Memnuniyet sözü ödeme isteği değildir (araştırma eki 04).

## Katılımcılar

- 5–10 yetişkin; düzenleme deneyimi az. Farklı teknik rahatlık düzeyleri.
- Kendi bilgisayarında Chrome ya da Edge (desteklenen tarayıcılar; Firefox'ta dışa
  aktarma kapalı, Safari test edilmedi).
- Kendi videosu: telefonla çekilmiş 1–3 dakikalık, konuşmalı bir kayıt. Video hiçbir
  yere yüklenmez; görüşmeyi yapan kişi de dosyayı istemez ve görmek zorunda değildir.

## Görevler (yönlendirme yok; kurucu ekranı göstermez)

**3 Ekim 2026'dan beri her görev açılış ekranından başlar** ("Ne yapmak istiyorsun?",
[ADR-034](../adr/ADR-034-task-first-home.md)): katılımcıya adres verilir
(https://erenulutas0.github.io/capcut/), editörün adresi verilmez. Kartı mı seçti, kutuya mı
yazdı, "Kendim düzenleyeceğim"e mi gitti — hangisini neden seçtiği not alınır.

0. **Açılış ekranı (yeni):** "Bu videoyla Instagram'da paylaşmak için dikey bir video
   yap ve cihazına kaydet." Beklenen yol: "Dikey yap" kartı (ya da kutuya yazıp Enter) →
   "Video seç" → "Doldur" / "Sığdır" → "İndir" → kaydetme penceresi (3–4 dokunuş). Not al:
   - İlk bakışta ne yapacağını anladı mı; kartı mı kullandı, kutuyu mu? **Kutuya ne yazdı?**
     (Yazdığı cümleyi **kelimesi kelimesine** not al: arama kelime listeleri bu cümlelerle
     büyüyecek — `web/tests/unit/taskSearchHeldOut.test.ts`.)
   - "Doldur" ile "Sığdır" arasındaki farkı önizlemeden anladı mı?
   - "Kaydedildi"den sonra ne yaptı: "Paylaş", "Başka bir video", "Ana ekrana dön"?
   - Aradığı iş yoksa ("Bunu henüz yapamıyoruz." ya da "Bunu bulamadım.") ne yaptı? Yanıtı
     anladı mı, başka kelimeyle mi denedi, bıraktı mı?
0b. **Serbest istek:** "Bu videoyla yapmak istediğin başka bir şey var mı? Dene." Yazdığı ya da
   aradığı şey ve sonucu not alınır (bulundu / yapamıyoruz / bulunamadı / yanlış iş çıktı).
   Sihirbazı olan diğer işler: "Boşlukları at" (3 dokunuş), "Müzik ekle" (4), "Sesini al" (3),
   "Sesi kapat" (3), "Küçült" (3–4), "Her yerde açılsın" (3). **"Yanlış iş çıktı" en önemli
   sonuçtur:** yazdığı cümleyi ve çıkan kartı aynen not al. 7 Ekim 2026'dan beri yapılamayan on
   istek (döndür, hızlandır / yavaşlat, videoları birleştir, GIF, filigran ya da logo sil, filtre
   ve renk, arka plan, tersten oynat, videodan fotoğraf, titremeyi düzelt) "Bunu henüz
   yapamıyoruz." yanıtını alıyor; bunların dışında bir istek yanlış karta giderse o da yeni bir
   satırdır (`web/tests/unit/taskSearchHeldOut2.test.ts`).
0c. **Sesi kapat (yeni, 7 Ekim 2026):** "Bu videonun sesini kapatıp kaydet." Beklenen yol:
   "Sesi kapat" kartı (ya da "sesini kapat" yazmak) → "Video seç" → "İndir" (3 dokunuş). Not
   al: "Sesini al" ile karıştırdı mı; kaydedilen dosyayı kendi oynatıcısında açınca sessiz
   olduğunu gördü mü; paylaştığı uygulama (WhatsApp, Instagram…) sessiz videoyu nasıl gösterdi
   (bu **ölçülmedi**: dosyada ses izi yok, sessizlik izi değil).
1. **Klip:** "Videondan en sevdiğin iki bölümü seç, 30–45 saniyelik dikey bir video
   hazırla ve bilgisayarına indir."
   Beklenen başlangıç: açılış ekranında **"Kes"** kartı → "Video seç" → kesit editörü aynı
   videoyla açılır (ikinci dosya penceresi yok). Katılımcı "Kes"i mi, "Kendim
   düzenleyeceğim"i mi seçti, not al.
   Arayüz 23 Eylül 2026'dan beri kesit listesidir (ADR-026): beklenen yol
   "Başlangıcı işaretle" → "Bitişi işaretle" (iki kez; 30 Eylül 2026'dan beri bitişi
   işaretlemek kesiti hemen listeye ekler, ayrı "Kesit ekle" adımı yok — ADR-030;
   düğmeler sözle, ilk açılışta "Nasıl kesilir?" ipucu), Ayarlar'da 9:16, sağ üstte
   "Hepsini birleştirip indir" (telefonda liste aşağıdayken alttaki çubukta da),
   kaydetme penceresinde yer ve ad. Not al:
   katılımcı kartın "İndir"inin (⬇) tek kesiti, sağ üst düğmenin hepsini indirdiğini fark etti mi;
   "kesit" kelimesini anladı mı; "Bitişi işaretle"ye basınca kesitin eklenmesini
   bekledi mi ya da şaşırdı mı; "Kesit ekle"ye (yalnızca kutulara yazılan zamanlar
   için) gerek duydu mu, basınca "Önce başlangıcı işaretle" yazısını anladı mı;
   kaydetme penceresi şaşırttı mı; tam ekranı (⛶) buldu mu. Telefonda: alttaki
   "Kesitler (N)" çubuğunu gördü mü, kullandı mı.
1b. **Tek kesit:** "Şimdi yalnızca ikinci bölümü ayrı bir video olarak indir."
   (Beklenen: o kartın "İndir"i (⬇); tek tıklama + pencere.)
2. **Altyazı ve ses:** "Videoya iki satır altyazı ekle; birinde bilerek bir yazım hatası
   yap ve sonra düzelt. Müzik ekle ve seviyesini konuşma duyulacak şekilde ayarla."
   (Kendi müziği yoksa görüşmeyi yapan kişi telifsiz kısa bir müzik dosyası verir.)
3. **Sessizlik:** "Konuşmadaki uzun duraklamaları kısalt, sonucu dinle, beğenmediğin bir
   kesimi geri al." Beklenen başlangıç: açılış ekranında "Boşlukları at" (ya da "sessiz
   yerleri sil" yazmak) → "N sessiz yer bulundu, videon kısalacak: X → Y" → "İndir". Tek tek
   dinleyip bir kesimi geri almak için "Daha fazla ayar → editörde aç" (kesimler kesit olarak
   gelir) ya da editörde "Diğer" ⋯ → "Sessizlikleri bul". Hangi yolu bulduğu ve sihirbazdaki
   özetin yetip yetmediği not alınır.

4. **Yazıya dök (yeni, 4 Ekim 2026 — [ADR-036](../adr/ADR-036-on-device-transcript.md)):**
   yalnızca **İngilizce konuşmalı** bir videosu olan katılımcıyla (yoksa bu görev atlanır;
   Türkçe videoda sonuç anlamsız çıkar ve bu bir hata sayılmaz — arayüz bunu baştan söylüyor mu,
   not al). "Bu videodaki konuşmayı yazıya dök; yanlış yazılmış bir kelimeyi düzelt; altyazılı
   videoyu indir." Beklenen yol: "Yazıya dök" kartı (ya da "altyazı ekle" yazmak) → "Video seç"
   → ilk kullanımda **"Modeli indir (≈108,8 MB, bir kez)"** → "Yazıya dök" → satırlar →
   kalem → düzelt → "Altyazılı videoyu indir" (ilk kullanımda 5 dokunuş + dosya penceresi,
   sonra 4). Not al:
   - "Şimdilik yalnızca İngilizce" cümlesini okudu mu, anladı mı?
   - Model indirmeyi **neden** gerektiğini anladı mı; 109 MB'ı ve "bir kez"i gördü mü; indirmeyi
     onayladı mı, vazgeçti mi? Mobil veriyle mi, Wi-Fi ile mi? (İndirme süresini yaz.)
   - Beklerken ne yaptı: ilerleme yazısını ("Konuşma aranıyor 03:10 / 12:00", "Yazılıyor: 14 / 87
     konuşma parçası") anladı mı; sayfayı kapattı ya da başka sekmeye geçti mi? **Süreyi yaz**
     (video uzunluğu ve geçen süre): masaüstü ölçümü konuşma süresinin 0,4–0,7 katı; dizüstü ve
     telefon ölçülmedi.
   - "Otomatik yazıldı — yanlış olabilir, düzeltebilirsin" cümlesini gördü mü; metne güvendi mi?
     Kaç yanlış kelime saydı (kabaca)? "(anlaşılamadı)" satırını gördüyse ne anladı?
   - Satıra dokununca videonun oraya gittiğini fark etti mi; kalemi buldu mu?
   - Sonuç: "Bu altyazılı videoyu paylaşır mıydın?" (evet / hayır, neden — okunabilirlik,
     satır uzunluğu, zamanlama).
4b. **Yazıdan kesit:** "Şimdi yalnızca şu cümlenin geçtiği yeri ayrı bir video yap." Beklenen
   yol: "Daha fazla ayar → editörde aç" → "Yazı" sekmesi → satır(lar)ı işaretle → "Bunlardan
   kesit yap" → "Kesitler" sekmesi → kesitin "İndir"i. Not al: işaret kutularını ve düğmeyi
   buldu mu; bitişik satırların tek kesit olmasını bekledi mi; kesitin başı/sonu sözü kesiyor mu
   (zaman hatası: ölçümde p95 ~0,2–0,25 s).

Rakip karşılaştırması (araştırma eki: iki doğrudan rakip) ikinci turda; ilk turda
yalnızca kendi ürünümüzdeki tıkanmaları görüyoruz.

## Ölçülenler (görev başına)

| Ölçüt | Nasıl |
|---|---|
| Yardımsız başarı | Evet / yardımla / başaramadı |
| Aktif süre | Görev başından indirmeye kadar; dışa aktarma bekleme süresi ayrı yazılır |
| Yanlış tıklama ve geri dönüş | Sayı ve nerede |
| Anlaşılmayan metin | Katılımcının sesli okuduğu ve takıldığı ifade |
| Sonuç kullanılabilir mi | Katılımcı: "Bunu paylaşır mıydın?" (evet/hayır ve neden) |
| Tanı dosyası | Hata olursa "Sorun bildir → Tanı dosyasını indir"; dosyayı katılımcı kendi isteğiyle gönderir |

Başlangıç hedefi (araştırma eki): 10 kişiden en az 8'i Görev 1'i yardımsız bitirsin.
Açılış ekranı için (ADR-034): 10 kişiden en az 9'u Görev 0'ı yardımsız bitirsin; kutuya
yazılan cümlelerin en az %80'inde doğru iş ilk sırada çıksın (ilk ölçüm, elle yazılmış 56
cümlede %86).
Tutmazsa yeni özellik değil, akışın yeniden tasarımı.

## Oturum akışı (30–40 dk)

1. Tanıtım (2 dk): "Programı test ediyoruz, seni değil. Takıldığın yer bizim hatamız."
2. İzin (1 dk): aşağıdaki metni oku, sözlü onay al.
3. Görevler (25 dk): katılımcı sesli düşünür; görüşmeyi yapan kişi yalnızca not alır.
4. Kapanış (5 dk): "En zor ne oldu? Bunu tekrar kullanır mıydın, ne için?"

## İzin metni (taslak)

> Bu görüşmede bir video düzenleme programının deneme sürümünü kullanacaksın. Kendi
> videonu kullanacaksın; video bilgisayarından çıkmaz ve biz görmeyiz. Ekranını
> paylaşman ya da görüşmenin kaydedilmesi isteğe bağlıdır; istemezsen yalnızca not
> alınır. Notlarda adın yazılmaz. İstediğin an bırakabilirsin.

(Hukuki metin değildir; K02 kararından sonra gözden geçirilir.)

## Not şablonu

```
Katılımcı: P01   Tarih:   Tarayıcı/sürüm:   Cihaz (RAM):
Video: süre ≈   kaynak (telefon marka/model, katılımcı biliyorsa):

Görev 0  başarı: E/Y/B   aktif süre:   yol: kart / yazarak / editör   kutuya yazdığı (aynen):
         "Doldur/Sığdır" anlaşıldı: E/H   kaydetme penceresi: sorunsuz/şaşırttı   sonra: Paylaş / başka video / ana ekran
Görev 0b istediği (aynen):   sonuç: bulundu / yapamıyoruz / bulunamadı / yanlış iş (çıkan kart:      )
Görev 0c başarı: E/Y/B   yol: kart / yazarak (yazdığı:      )   "Sesini al"a gitti mi: E/H   dosya sessiz: E/H   paylaşılan uygulamada:
Görev 1  başlangıç: Kes kartı / Kendim düzenleyeceğim / yazarak
Görev 1  başarı: E/Y/B   aktif süre:   export süresi:   takıldığı yer:
         kart "İndir" / "Hepsini birleştirip indir" farkı anlaşıldı: E/H   kaydetme penceresi: sorunsuz/şaşırttı
Görev 1b başarı: E/Y/B   takıldığı yer:
Görev 2  başarı: E/Y/B   aktif süre:   takıldığı yer:
Görev 3  başarı: E/Y/B   aktif süre:   takıldığı yer:
Hata/tanı dosyası: var/yok  kod:
Anlaşılmayan metinler:
Paylaşır mıydı: E/H, neden:
Tekrar kullanır mıydı, ne için:
```

## Sonrası

Notlar `docs/beta/sessions/` altında (katılımcı adı olmadan) toplanır. Her tıkanma bir
ADR ya da iş kalemi olur; aynı tıkanma iki kişide görülürse önceliklidir.
